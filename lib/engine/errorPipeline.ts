/**
 * Error resolution (gen.md sections 7, 8, 19).
 *
 *   ERROR -> fingerprint -> internal index -> version filter -> retrieval
 *         -> (if insufficient) research -> normalize -> index
 *         -> rank evidence -> recommendation
 *
 * The index is always consulted first. Research only runs when what we already
 * know is insufficient, which is what makes the agent loop in section 19 cheap
 * on the second occurrence of an error.
 */

import { categorize, confidenceCaveat, scoreConfidence, isAssertable } from './analysis/confidence';
import { deduplicate } from './analysis/dedupe';
import { extractKnowledge } from './analysis/extract';
import { fingerprintError, retrievalText, type FingerprintInput } from './analysis/errorFingerprint';
import { normalizeDocument } from './analysis/normalize';
import { shortHash } from './hash';
import { backfillEmbeddings } from './index/backfill';
import { embedQuery } from './index/embeddings';
import { getStore, type KnowledgeStore, type ScoredKnowledge } from './index/store';
import { detectEcosystem } from './ingestion/manifest';
import {
  SOURCE_TRUST,
  severityForType,
  type Ecosystem,
  type ErrorFingerprint,
  type KnowledgeObject,
  type KnowledgeType,
  type MigrationStep,
  type SourceType,
} from './knowledge';
import { fetchDocument } from './research/fetcher';
import { releaseForTag, searchIssues, type GitHubIssue } from './research/github';
import { tryFetchPackageMetadata, type PackageMetadata } from './research/registry';
import { buildErrorQueries, searchWeb } from './research/search';
import { classifySource, docsDomain, domainOf } from './research/sources';
import { parse, satisfies } from './semver';

export interface ResolveErrorInput extends FingerprintInput {
  ecosystem?: Ecosystem;
  previousVersion?: string;
  repository?: string;
  refresh?: boolean;
  /** Skip live research and answer only from the index. */
  indexOnly?: boolean;
  maxDocuments?: number;
  store?: KnowledgeStore;
}

export interface EvidenceItem {
  knowledgeId: string;
  type: KnowledgeObject['type'];
  title: string;
  url: string;
  sourceType: string;
  quotedText?: string;
  confidence: number;
  /** Whether this knowledge's version range covers the reported version. */
  appliesToVersion: boolean;
}

export interface ErrorResolution {
  fingerprint: ErrorFingerprint;
  diagnosis: string;
  likelyCause: string | null;
  fix: MigrationStep[];
  affectedVersions: string[];
  fixedVersions: string[];
  repositoryImpact: string[];
  confidence: number;
  confidenceCategory: ReturnType<typeof categorize>;
  caveat: string | null;
  evidence: EvidenceItem[];
  trace: ErrorResolutionTrace;
}

export interface ErrorResolutionTrace {
  indexHits: number;
  /** Whether index results alone met the sufficiency bar. */
  servedFromIndex: boolean;
  queriesRun: Array<{ label: string; query: string; results: number }>;
  issuesSearched: number;
  documentsFetched: number;
  knowledgeIndexed: number;
  searchUnavailable: boolean;
}

/**
 * Retrieval is "sufficient" when something both matches the error text and is
 * evidenced well enough to act on. A high lexical score over weak sources is not
 * sufficient — that is how a Stack Overflow guess becomes a confident answer.
 */
const SUFFICIENT_SCORE = 0.3;

function isSufficient(results: ScoredKnowledge[], version?: string): boolean {
  return results.some(
    (result) =>
      result.score >= SUFFICIENT_SCORE &&
      result.knowledge.confidence >= 0.5 &&
      (result.signals.exactErrorMatch === 1 || result.signals.versionMatch === 1) &&
      (!version || appliesTo(result.knowledge, version)),
  );
}

function appliesTo(knowledge: KnowledgeObject, version: string): boolean {
  if (!knowledge.affected) return true;
  return satisfies(version, knowledge.affected);
}

const FIXED_IN = /\b(?:fixed|resolved|patched|released|shipped|available)\s+(?:in|with|via|as of)?\s*v?(\d+\.\d+(?:\.\d+)?)/gi;

/** Versions an issue or release note claims resolve the problem (gen.md section 9). */
export function extractFixedVersions(text: string): string[] {
  return [...new Set([...text.matchAll(FIXED_IN)].map((match) => match[1]))];
}

/**
 * A GitHub issue becomes knowledge in its own right: it is the most common place
 * a version-specific error is described and later marked resolved.
 */
function knowledgeFromIssue(
  issue: GitHubIssue,
  packageName: string,
  ecosystem: Ecosystem,
  fingerprint: ErrorFingerprint,
): KnowledgeObject {
  const fixedVersions = extractFixedVersions(`${issue.title}\n${issue.body}`);
  const isResolved = issue.state === 'closed' && fixedVersions.length > 0;
  const type = isResolved ? 'error_solution' : 'github_issue';
  const now = new Date().toISOString();

  const source = {
    url: issue.htmlUrl,
    domain: 'github.com',
    sourceType: 'official_issue' as const,
    trustScore: SOURCE_TRUST.official_issue,
    retrievedAt: now,
    contentHash: shortHash(issue.body || issue.title, 32),
    title: `#${issue.number} ${issue.title}`,
    publishedAt: issue.createdAt,
    quotedText: (issue.body || issue.title).slice(0, 500),
  };

  const confidence = scoreConfidence({
    sourceTypes: ['official_issue'],
    independentDomains: 1,
    // The issue text contains the error type we are diagnosing.
    exactErrorMatch: `${issue.title}\n${issue.body}`.includes(fingerprint.errorType),
    exactVersionMatch: Boolean(fingerprint.packageVersion && issue.body.includes(fingerprint.packageVersion)),
    provenance: 'official',
  });

  return {
    id: `k_${shortHash(`${issue.htmlUrl}:${fingerprint.fingerprint}`, 20)}`,
    type,
    package: packageName,
    ecosystem,
    introduced: fingerprint.packageVersion,
    fixed: fixedVersions[0],
    affected: fixedVersions[0] && fingerprint.packageVersion
      ? `>=${fingerprint.packageVersion} <${fixedVersions[0]}`
      : undefined,
    title: issue.title,
    description: (issue.body || issue.title).slice(0, 1500),
    summary: issue.title,
    affectedApis: fingerprint.stackSymbols.slice(0, 4),
    affectedConfig: [],
    migration: [],
    severity: severityForType(type),
    provenance: 'official',
    sources: [source],
    confidence: confidence.score,
    fingerprint: shortHash(`${packageName}|${type}|issue-${issue.number}`, 20),
    embedding: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function researchError(
  fingerprint: ErrorFingerprint,
  metadata: PackageMetadata | null,
  ecosystem: Ecosystem,
  options: { refresh: boolean; maxDocuments: number },
  trace: ErrorResolutionTrace,
): Promise<KnowledgeObject[]> {
  const found: KnowledgeObject[] = [];

  // GitHub issues first: they are version-specific, authored by maintainers, and
  // frequently state the fixing release outright.
  if (metadata?.githubSlug) {
    const query = [fingerprint.errorType, fingerprint.errorCode].filter(Boolean).join(' ');
    const issues = await searchIssues(metadata.githubSlug, query, options.refresh);
    trace.issuesSearched = issues.length;

    for (const issue of issues) {
      found.push(knowledgeFromIssue(issue, fingerprint.package, ecosystem, fingerprint));
    }
  }

  // Release notes for the failing version, and for the release that opened its
  // major. Issues describe the symptom; the major-boundary release is where the
  // maintainer states the cause — chalk 5.0.0 says "this package is now pure
  // ESM", which is the whole answer to "chalk.green is not a function". This
  // path needs no web search, so it is the one authoritative source still
  // reachable when SERP is unconfigured.
  if (metadata?.githubSlug && fingerprint.packageVersion) {
    const parsed = parse(fingerprint.packageVersion);
    const versions = [...new Set([fingerprint.packageVersion, parsed ? `${parsed.major}.0.0` : null])];

    for (const version of versions) {
      if (!version) continue;

      const release = await releaseForTag(metadata.githubSlug, version, options.refresh);
      if (!release?.body) continue;

      const title = release.name || `${fingerprint.package} ${version}`;
      const normalized = normalizeDocument(release.body, 'text/markdown', title);
      found.push(
        ...extractKnowledge(normalized, {
          package: fingerprint.package,
          ecosystem,
          documentVersion: release.version || version,
          toVersion: release.version || version,
          maxClaims: 25,
          source: {
            url: release.htmlUrl,
            domain: 'github.com',
            sourceType: 'official_release',
            trustScore: SOURCE_TRUST.official_release,
            retrievedAt: new Date().toISOString(),
            contentHash: shortHash(release.body, 20),
            title,
            publishedAt: release.publishedAt,
          },
        }),
      );
    }
  }

  // Then the multi-angle web searches from gen.md section 8.
  const queries = buildErrorQueries({
    package: fingerprint.package,
    version: fingerprint.packageVersion,
    errorType: fingerprint.errorType,
    normalizedMessage: fingerprint.normalizedMessage,
    repoSlug: metadata?.githubSlug,
    docsDomain: metadata ? docsDomain(metadata) : undefined,
  });

  const seen = new Set<string>();
  let fetched = 0;

  for (const { label, query } of queries) {
    if (fetched >= options.maxDocuments) break;

    const results = await searchWeb(query, 5);
    trace.queriesRun.push({ label, query, results: results.length });
    if (results.length === 0) continue;

    for (const result of results) {
      if (fetched >= options.maxDocuments) break;
      if (seen.has(result.url)) continue;
      seen.add(result.url);

      const sourceType = classifySource(result.url);
      let document;
      try {
        document = await fetchDocument(result.url, { sourceType, refresh: options.refresh });
      } catch {
        continue;
      }
      fetched++;

      const normalized = normalizeDocument(document.body, document.contentType, result.title);
      found.push(
        ...extractKnowledge(normalized, {
          package: fingerprint.package,
          ecosystem,
          fromVersion: fingerprint.packageVersion,
          toVersion: fingerprint.packageVersion,
          maxClaims: 25,
          source: {
            url: result.url,
            domain: domainOf(result.url),
            sourceType,
            trustScore: SOURCE_TRUST[sourceType],
            retrievedAt: document.retrievedAt,
            contentHash: document.contentHash,
            title: result.title,
          },
        }),
      );
    }
  }

  trace.documentsFetched = fetched;
  trace.searchUnavailable = trace.queriesRun.every((entry) => entry.results === 0);

  return found;
}

function buildDiagnosis(fingerprint: ErrorFingerprint, top: ScoredKnowledge | undefined): string {
  const version = fingerprint.packageVersion ? ` ${fingerprint.packageVersion}` : '';

  if (!top) {
    return `${fingerprint.errorType} raised by ${fingerprint.package}${version}. No indexed knowledge matches this error.`;
  }

  return (
    `${fingerprint.errorType} raised by ${fingerprint.package}${version}. ` +
    `The closest indexed knowledge is a ${top.knowledge.type.replace(/_/g, ' ')}: "${top.knowledge.title}".`
  );
}

function buildFix(results: ScoredKnowledge[]): MigrationStep[] {
  const steps: MigrationStep[] = [];

  for (const { knowledge } of results) {
    // Only act on knowledge that is evidenced well enough to assert.
    if (!isAssertable(knowledge.confidence)) continue;
    for (const step of knowledge.migration) {
      if (steps.some((existing) => existing.description === step.description)) continue;
      steps.push(step);
    }
  }

  return steps.slice(0, 6);
}

/**
 * Knowledge types that explain why an error happens, as opposed to reporting
 * that it happened. Retrieved separately from the symptom search.
 */
const CAUSE_TYPES: KnowledgeType[] = [
  'breaking_change',
  'removed_api',
  'renamed_api',
  'deprecated_api',
  'configuration_change',
  'runtime_requirement',
  'dependency_requirement',
];

/** Source types that make a claim authoritative about the package's own behaviour. */
const AUTHORITATIVE = new Set<SourceType>([
  'official_migration_guide',
  'official_docs',
  'official_changelog',
  'official_release',
]);

/**
 * Identifiers the error names, minus the package itself.
 *
 * `chalk.green` yields `green`, not `chalk`. Keeping the receiver would make
 * every claim about the package match every error from it — the first version
 * of this picked "chalk.Instance → Chalk" to explain `chalk.green`, on the
 * strength of the word "chalk".
 */
function errorSymbols(fingerprint: ErrorFingerprint): Set<string> {
  const noise = packageTokens(fingerprint.package);
  const symbols = new Set<string>();

  const add = (raw: string) => {
    const token = raw.toLowerCase();
    if (token && !noise.has(token)) symbols.add(token);
  };

  for (const symbol of fingerprint.stackSymbols) {
    for (const part of symbol.split('.')) add(part);
  }

  for (const match of fingerprint.message.matchAll(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) {
    add(match[1]);
    add(match[2]);
  }

  return symbols;
}

/** The package's own name in the forms it appears as an identifier. */
function packageTokens(packageName: string): Set<string> {
  const bare = packageName.toLowerCase().replace(/^@[^/]+\//, '');
  return new Set([packageName.toLowerCase(), bare, bare.replace(/-/g, ''), bare.replace(/-/g, '_')]);
}

/**
 * How well a cause explains *this* error, lower being better.
 *
 * A change that names APIs the error does not mention is a poor explanation of
 * it: chalk 5 removing `.keyword()` and `.hsl()` says nothing about why
 * `chalk.green` is undefined. A change that names no API at all — "this package
 * is now pure ESM" — is general, and general changes explain symptoms that name
 * any member. So a change about other symbols ranks below a general one, which
 * is the opposite of what relevance scoring alone produces.
 */
function explanatoryRank(knowledge: KnowledgeObject, symbols: Set<string>, packageName: string): number {
  const noise = packageTokens(packageName);
  const apis = knowledge.affectedApis
    .map((api) => api.replace(/\(\)$/, '').replace(/^\./, '').toLowerCase())
    .filter((api) => api && !noise.has(api));

  if (apis.length === 0) return 1;
  return apis.some((api) => symbols.has(api) || symbols.has(api.split('.').pop() ?? '')) ? 0 : 2;
}

/**
 * Picks the claim the diagnosis is built on.
 *
 * Retrieval order is by relevance to the error text, which favours issues that
 * quote the same message. That is the right first answer for "have others hit
 * this", and the wrong one for "why". When an authoritative cause is present it
 * leads instead, because a maintainer stating what changed beats a stranger
 * reporting the same stack trace — ordered by how well it explains the symbols
 * the error actually named.
 */
function pickPrimary(candidates: ScoredKnowledge[], fingerprint: ErrorFingerprint): ScoredKnowledge | undefined {
  const symbols = errorSymbols(fingerprint);

  const causes = candidates.filter(
    ({ knowledge }) =>
      CAUSE_TYPES.includes(knowledge.type) &&
      knowledge.sources.some((source) => AUTHORITATIVE.has(source.sourceType)),
  );

  // Stable within a rank, so retrieval order still breaks ties.
  const best = causes
    .map((candidate, position) => ({
      candidate,
      position,
      rank: explanatoryRank(candidate.knowledge, symbols, fingerprint.package),
    }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)[0];

  return best?.candidate ?? candidates[0];
}

export async function resolveError(input: ResolveErrorInput): Promise<ErrorResolution> {
  const {
    refresh = false,
    indexOnly = false,
    maxDocuments = 5,
    store = getStore(),
  } = input;

  const ecosystem = input.ecosystem ?? detectEcosystem(input.package, 'nodejs');
  const fingerprint = fingerprintError(input);

  const trace: ErrorResolutionTrace = {
    indexHits: 0,
    servedFromIndex: false,
    queriesRun: [],
    issuesSearched: 0,
    documentsFetched: 0,
    knowledgeIndexed: 0,
    searchUnavailable: false,
  };

  const text = retrievalText(fingerprint);
  const query = {
    text,
    package: input.package,
    ecosystem,
    version: input.version,
    errorType: fingerprint.errorType,
    limit: 12,
    // Null with no embedder configured, and null again if the provider fails;
    // either way the store scores lexically and the answer still comes back.
    embedding: await embedQuery(text),
  };

  let results = await store.search(query);
  trace.indexHits = results.length;

  if (isSufficient(results, input.version) && !refresh) {
    trace.servedFromIndex = true;
  } else if (!indexOnly) {
    const metadata = await tryFetchPackageMetadata(input.package, ecosystem, refresh);
    const researched = await researchError(fingerprint, metadata, ecosystem, { refresh, maxDocuments }, trace);

    const deduped = deduplicate(researched);
    if (deduped.knowledge.length > 0) {
      const upserted = await store.upsert(deduped.knowledge);
      trace.knowledgeIndexed = upserted.inserted + upserted.updated;

      // Embed before re-searching. Knowledge indexed a moment ago has no vector,
      // so without this the answer to a first-contact error is always lexical —
      // exactly the case where the phrasing gap is widest. A no-op when no
      // embedder is configured.
      await backfillEmbeddings({ store, ids: deduped.knowledge.map((item) => item.id) });
    }

    results = await store.search(query);
  }

  // A second, narrower retrieval for the *cause*.
  //
  // Symptom and cause are written in different vocabularies. Issues say
  // "TypeError: chalk.green is not a function"; the release note that explains
  // it says "This package is now pure ESM" and shares not one word with the
  // error. Ranked together the issues win every time, and the answer sits below
  // the cut — measured on chalk 5.6.2, the release note ranked 15th of 23.
  // So breaking changes for the version in play are retrieved separately rather
  // than made to compete on the error's own wording.
  const causes = await store.search({ ...query, types: [...CAUSE_TYPES], limit: 6 });

  const merged = [...results];
  const seen = new Set(results.map(({ knowledge }) => knowledge.id));
  for (const candidate of causes) {
    if (seen.has(candidate.knowledge.id)) continue;
    seen.add(candidate.knowledge.id);
    merged.push(candidate);
  }

  const applicable = merged.filter(({ knowledge }) => !input.version || appliesTo(knowledge, input.version));

  // The best symptom match still leads the diagnosis — it is what the caller
  // actually hit — but an authoritative cause outranks a community symptom when
  // one was found.
  const top = pickPrimary(applicable, fingerprint);

  const affectedVersions = [
    ...new Set(applicable.map(({ knowledge }) => knowledge.affected ?? knowledge.introduced).filter(Boolean)),
  ] as string[];
  const fixedVersions = [
    ...new Set(applicable.map(({ knowledge }) => knowledge.fixed).filter(Boolean)),
  ] as string[];

  const scored = top
    ? scoreConfidence({
        sourceTypes: top.knowledge.sources.map((source) => source.sourceType),
        independentDomains: new Set(top.knowledge.sources.map((source) => source.domain)).size,
        exactErrorMatch: top.signals.exactErrorMatch === 1,
        exactVersionMatch: top.signals.versionMatch === 1,
        provenance: top.knowledge.provenance,
      })
    : { score: 0, category: categorize(0) as ReturnType<typeof categorize> };

  // The stored confidence already carries what a single-shot recompute cannot
  // see: corroboration from re-research, and repositories that reported the fix
  // working. Reporting a validated claim at its pre-validation score told the
  // user "35% → 55%" and then answered 35% the next time they asked.
  const confidence = {
    score: Math.max(scored.score, top?.knowledge.confidence ?? 0),
    category: scored.category,
  };

  return {
    fingerprint,
    diagnosis: buildDiagnosis(fingerprint, top),
    likelyCause: top ? top.knowledge.description.slice(0, 600) : null,
    fix: buildFix(applicable),
    affectedVersions,
    fixedVersions,
    // Phase 4 (gen.md section 14) resolves this against the real repository. The
    // stack symbols are what a caller should grep for in the meantime.
    repositoryImpact: fingerprint.stackSymbols,
    confidence: confidence.score,
    confidenceCategory: categorize(confidence.score),
    caveat: confidenceCaveat(confidence.score),
    evidence: applicable.slice(0, 8).map(({ knowledge }) => ({
      knowledgeId: knowledge.id,
      type: knowledge.type,
      title: knowledge.title,
      url: knowledge.sources[0]?.url ?? '',
      sourceType: knowledge.sources[0]?.sourceType ?? 'web',
      quotedText: knowledge.sources[0]?.quotedText,
      confidence: knowledge.confidence,
      appliesToVersion: !input.version || appliesTo(knowledge, input.version),
    })),
    trace,
  };
}
