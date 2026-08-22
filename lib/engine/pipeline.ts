/**
 * The pipeline (gen.md section 28).
 *
 *   INPUT -> RESEARCH -> NORMALIZATION -> STRUCTURED KNOWLEDGE -> INDEX
 *         -> RETRIEVAL -> EVIDENCE -> MIGRATION PLAN
 *
 * Markdown is generated from the indexed knowledge at the end (`output/markdown.ts`),
 * never accumulated as the working representation.
 */

import { deduplicate } from './analysis/dedupe';
import { extractKnowledge } from './analysis/extract';
import { normalizeDocument } from './analysis/normalize';
import { assessRisk, describeChange, overallSafety, type RiskAssessment, type VersionChange } from './analysis/versionDiff';
import { SOURCE_TRUST, type KnowledgeObject, type SourceRef } from './knowledge';
import type { ManifestParseResult } from './ingestion/manifest';
import { backfillEmbeddings } from './index/backfill';
import { getStore, type KnowledgeStore } from './index/store';
import type { PackageRef } from './request';
import { prioritizeReleases, releaseForTag, releasesInWindow } from './research/github';
import { fetchDocument, FetchError, type FetchResult } from './research/fetcher';
import { resolveTargetVersion, tryFetchPackageMetadata, type PackageMetadata, type TargetPolicy } from './research/registry';
import { buildUpgradeQueries, searchWeb } from './research/search';
import { classifySource, docsDomain, domainOf, planUpgradeSources, type SourceCandidate } from './research/sources';

export interface ResearchOptions {
  /** Bypass both the fetch cache and index coverage checks. */
  refresh?: boolean;
  /** Max documents fetched per package. Bounds scrape cost and latency. */
  maxDocuments?: number;
  targetPolicy?: TargetPolicy;
  /** Explicit target, overriding registry resolution. */
  targetVersion?: string;
  /** Run web search discovery when deterministic sources are thin. */
  allowSearch?: boolean;
  store?: KnowledgeStore;
}

export interface FetchedSource {
  url: string;
  sourceType: SourceCandidate['sourceType'];
  title: string;
  transport: FetchResult['transport'];
  fromCache: boolean;
  extracted: number;
}

export interface ResearchTrace {
  planned: number;
  fetched: FetchedSource[];
  failures: Array<{ url: string; reason: string }>;
  cacheHits: number;
  extractedBeforeDedupe: number;
  collapsedByDedupe: number;
  contradictions: number;
  usedSearch: boolean;
  /** True when the index already covered this upgrade and no fetching happened. */
  servedFromIndex: boolean;
}

export interface PackageResearchResult {
  package: string;
  ecosystem: PackageRef['ecosystem'];
  change: VersionChange;
  metadata: PackageMetadata | null;
  knowledge: KnowledgeObject[];
  risk: RiskAssessment;
  trace: ResearchTrace;
  warnings: string[];
}

const DEFAULT_MAX_DOCUMENTS = 6;

function sourceRefFor(candidate: SourceCandidate, document: FetchResult, publishedAt?: string): SourceRef {
  return {
    url: candidate.url,
    domain: domainOf(candidate.url),
    sourceType: candidate.sourceType,
    trustScore: candidate.trustScore,
    retrievedAt: document.retrievedAt,
    contentHash: document.contentHash,
    title: candidate.title,
    publishedAt,
  };
}

/**
 * Researches one package upgrade end to end.
 *
 * Order matters: registry first (it decides the target version and where the
 * real sources live), then GitHub releases in the version window (highest yield,
 * exact version anchoring), then the planned document sources, then — only if
 * still thin — web search.
 */
export async function researchPackageUpgrade(
  ref: PackageRef,
  options: ResearchOptions = {},
): Promise<PackageResearchResult> {
  const {
    refresh = false,
    maxDocuments = DEFAULT_MAX_DOCUMENTS,
    targetPolicy = 'latest',
    targetVersion: explicitTarget,
    allowSearch = true,
    store = getStore(),
  } = options;

  const warnings: string[] = [];
  const trace: ResearchTrace = {
    planned: 0,
    fetched: [],
    failures: [],
    cacheHits: 0,
    extractedBeforeDedupe: 0,
    collapsedByDedupe: 0,
    contradictions: 0,
    usedSearch: false,
    servedFromIndex: false,
  };

  const metadata = await tryFetchPackageMetadata(ref.name, ref.ecosystem, refresh);
  if (!metadata) warnings.push(`${ref.name}: registry lookup failed — target version and source URLs are unknown.`);

  const targetVersion = explicitTarget ?? resolveTargetVersion(metadata, ref.currentVersion, targetPolicy);
  if (!targetVersion) {
    warnings.push(`${ref.name}: no newer version found — nothing to research.`);
  }

  const change = describeChange(ref, targetVersion);

  // Incremental indexing (gen.md section 23): reuse what we already know.
  if (!refresh && targetVersion && (await store.hasCoverage(ref.name, targetVersion))) {
    const existing = await store.search({
      package: ref.name,
      version: targetVersion,
      limit: 100,
    });
    const knowledge = existing.map((result) => result.knowledge);

    if (knowledge.length > 0) {
      trace.servedFromIndex = true;
      return {
        package: ref.name,
        ecosystem: ref.ecosystem,
        change,
        metadata,
        knowledge,
        risk: assessRisk(change, knowledge),
        trace,
        warnings,
      };
    }
  }

  const extracted: KnowledgeObject[] = [];

  if (metadata && targetVersion) {
    // Release notes in the version window.
    if (metadata.githubSlug) {
      const window = await releasesInWindow(metadata.githubSlug, ref.currentVersion, targetVersion, refresh);

      // High-frequency publishers (Next.js ships canaries daily) push the target
      // release past the pages we list, leaving the window empty or truncated.
      // Fetch the target's tag directly so the most relevant release is never missed.
      if (!window.some((release) => release.version === targetVersion)) {
        const tagged = await releaseForTag(metadata.githubSlug, targetVersion, refresh);
        if (tagged) window.push(tagged);
      }

      const releases = prioritizeReleases(window, targetVersion, maxDocuments);

      for (const release of releases) {
        if (!release.body.trim()) continue;

        const candidate: SourceCandidate = {
          url: release.htmlUrl,
          sourceType: 'official_release',
          title: `${ref.name} ${release.tagName} release notes`,
          reason: 'release notes inside the upgrade window',
          priority: 3,
          trustScore: SOURCE_TRUST.official_release,
          speculative: false,
        };

        const document = normalizeDocument(release.body, 'text/markdown', candidate.title);
        const knowledge = extractKnowledge(document, {
          package: ref.name,
          ecosystem: ref.ecosystem,
          documentVersion: release.version,
          fromVersion: ref.currentVersion,
          toVersion: targetVersion,
          source: {
            url: release.htmlUrl,
            domain: 'github.com',
            sourceType: 'official_release',
            trustScore: SOURCE_TRUST.official_release,
            retrievedAt: new Date().toISOString(),
            contentHash: '',
            title: candidate.title,
            publishedAt: release.publishedAt,
          },
        });

        extracted.push(...knowledge);
        trace.fetched.push({
          url: release.htmlUrl,
          sourceType: 'official_release',
          title: candidate.title,
          transport: 'direct',
          fromCache: false,
          extracted: knowledge.length,
        });
      }
    }

    // Planned document sources, in priority order, until the budget is spent.
    const planned = planUpgradeSources(metadata, targetVersion);
    trace.planned = planned.length;

    /**
     * The budget counts *productive* fetches. A speculative URL that resolves to
     * a docs landing page yields nothing, and letting those consume the budget
     * starved the release notes that actually document the upgrade. Total
     * attempts are still bounded so a package with many dead conventions cannot
     * fan out indefinitely.
     */
    let productive = trace.fetched.length;
    let attempts = 0;
    // A floor matters at small budgets: with maxDocuments=2 a limit of 6 could be
    // spent entirely on dead ends before reaching a real source.
    const attemptLimit = Math.max(8, maxDocuments * 3);

    for (const candidate of planned) {
      if (productive >= maxDocuments || attempts >= attemptLimit) break;
      attempts++;

      let document: FetchResult;
      try {
        document = await fetchDocument(candidate.url, { sourceType: candidate.sourceType, refresh });
      } catch (error) {
        // Speculative URLs are conventions, not promises — a 404 is expected.
        if (!candidate.speculative) {
          trace.failures.push({
            url: candidate.url,
            reason: error instanceof FetchError ? error.message : String(error),
          });
        }
        continue;
      }

      if (document.fromCache) trace.cacheHits++;

      const normalized = normalizeDocument(document.body, document.contentType, candidate.title);
      const knowledge = extractKnowledge(normalized, {
        package: ref.name,
        ecosystem: ref.ecosystem,
        fromVersion: ref.currentVersion,
        toVersion: targetVersion,
        source: sourceRefFor(candidate, document),
      });

      extracted.push(...knowledge);
      trace.fetched.push({
        url: candidate.url,
        sourceType: candidate.sourceType,
        title: candidate.title,
        transport: document.transport,
        fromCache: document.fromCache,
        extracted: knowledge.length,
      });

      if (!candidate.speculative || knowledge.length > 0) productive++;
    }

    // Search discovery, only when the authoritative sources came up short.
    if (allowSearch && extracted.length === 0) {
      const [query] = buildUpgradeQueries(ref.name, ref.currentVersion, targetVersion);
      const results = await searchWeb(query.query, 5);
      trace.usedSearch = results.length > 0;

      for (const result of results.slice(0, Math.max(0, maxDocuments - trace.fetched.length))) {
        const sourceType = classifySource(result.url);
        let document: FetchResult;
        try {
          document = await fetchDocument(result.url, { sourceType, refresh });
        } catch {
          continue;
        }

        const normalized = normalizeDocument(document.body, document.contentType, result.title);
        const knowledge = extractKnowledge(normalized, {
          package: ref.name,
          ecosystem: ref.ecosystem,
          fromVersion: ref.currentVersion,
          toVersion: targetVersion,
          source: {
            url: result.url,
            domain: domainOf(result.url),
            sourceType,
            trustScore: SOURCE_TRUST[sourceType],
            retrievedAt: document.retrievedAt,
            contentHash: document.contentHash,
            title: result.title,
          },
        });

        extracted.push(...knowledge);
        trace.fetched.push({
          url: result.url,
          sourceType,
          title: result.title,
          transport: document.transport,
          fromCache: document.fromCache,
          extracted: knowledge.length,
        });
      }
    }
  }

  trace.extractedBeforeDedupe = extracted.length;

  const deduped = deduplicate(extracted);
  trace.collapsedByDedupe = deduped.collapsed;
  trace.contradictions = deduped.contradictions.length;

  if (deduped.knowledge.length > 0) {
    await store.upsert(deduped.knowledge);
    // Same reason as the error path: knowledge with no vector is invisible to
    // semantic retrieval until something embeds it.
    await backfillEmbeddings({ store, ids: deduped.knowledge.map((item) => item.id) });
  }

  if (targetVersion && deduped.knowledge.length === 0 && trace.fetched.length > 0) {
    warnings.push(
      `${ref.name}: sources were retrieved but no change claims could be extracted — treat "no breaking changes" as unverified.`,
    );
  }

  return {
    package: ref.name,
    ecosystem: ref.ecosystem,
    change,
    metadata,
    knowledge: deduped.knowledge,
    risk: assessRisk(change, deduped.knowledge),
    trace,
    warnings,
  };
}

export interface ManifestResearchResult {
  id: string;
  createdAt: string;
  ecosystem: ManifestParseResult['ecosystem'];
  fileName: string;
  results: PackageResearchResult[];
  overallSafety: ReturnType<typeof overallSafety>;
  totalKnowledge: number;
  warnings: string[];
}

/**
 * Researches every package in a manifest.
 *
 * Concurrency is bounded: each package can issue many network calls, and both the
 * registries and Bright Data are rate-limited shared resources.
 */
export async function researchManifest(
  parsed: ManifestParseResult,
  options: ResearchOptions & { concurrency?: number; packages?: string[] } = {},
): Promise<ManifestResearchResult> {
  const { concurrency = 3, packages: only, ...researchOptions } = options;

  const targets = only ? parsed.packages.filter((pkg) => only.includes(pkg.name)) : parsed.packages;
  const results: PackageResearchResult[] = new Array(targets.length);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const position = cursor++;
      results[position] = await researchPackageUpgrade(targets[position], researchOptions);
    }
  });
  await Promise.all(workers);

  const settled = results.filter(Boolean);

  return {
    id: `analysis_${Date.now()}`,
    createdAt: new Date().toISOString(),
    ecosystem: parsed.ecosystem,
    fileName: parsed.fileName,
    results: settled,
    overallSafety: overallSafety(settled.map((result) => result.risk.level)),
    totalKnowledge: settled.reduce((total, result) => total + result.knowledge.length, 0),
    warnings: [...parsed.warnings, ...settled.flatMap((result) => result.warnings)],
  };
}

export { docsDomain };
