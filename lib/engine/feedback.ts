/**
 * Learning from verified fixes (gen.md section 20).
 *
 * When an agent applies a migration and the repository's own checks pass, that is
 * evidence — but weaker evidence than documentation, and evidence about one
 * repository. This module records it under a distinct provenance, reinforces the
 * knowledge that led to it, and lets a refutation take confidence back.
 *
 * The rule that makes the loop safe: an agent's report can never raise something
 * to the confidence of an authoritative source. Passing tests prove a change works
 * here; they do not prove it is the migration the maintainers intended.
 */

import { scoreConfidence } from './analysis/confidence';
import { fingerprintError } from './analysis/errorFingerprint';
import { shortHash } from './hash';
import { getStore, type KnowledgeStore } from './index/store';
import { detectEcosystem } from './ingestion/manifest';
import {
  validationSucceeded,
  type Ecosystem,
  type KnowledgeObject,
  type MigrationStep,
  type SourceRef,
  type ValidationRecord,
} from './knowledge';
import { affectedRange, coerce, parse, sortVersionsAscending } from './semver';

export interface FixReport {
  package: string;
  ecosystem?: Ecosystem;
  version?: string;
  previousVersion?: string;

  /** The error this fix resolved, if it came from error mode. */
  error?: string;
  stackTrace?: string;

  /** What the agent actually changed. */
  fix: MigrationStep[];
  /** One-line description of the change, used as the knowledge title. */
  summary: string;

  /** Knowledge ids the agent acted on, so success can reinforce them. */
  derivedFrom?: string[];

  /** Result of the repository's own checks. */
  validation: {
    tests?: 'passed' | 'failed' | 'skipped';
    typecheck?: 'passed' | 'failed' | 'skipped';
    build?: 'passed' | 'failed' | 'skipped';
    notes?: string;
  };

  /** Identifies the reporting repository so confirmations can be counted once each. */
  repository?: string;

  store?: KnowledgeStore;
}

export interface FeedbackResult {
  recorded: KnowledgeObject | null;
  succeeded: boolean;
  /** Ids whose confidence moved, with before/after. */
  reinforced: Array<{ id: string; before: number; after: number }>;
  message: string;
}

/**
 * Repositories are identified by a hash, not by path.
 *
 * Confirmation counting needs to know whether two reports came from the same
 * place; it does not need to know where that place is, and storing absolute paths
 * in a shared index would leak directory layouts.
 */
function repositoryKey(repository?: string): string {
  return repository ? shortHash(repository, 12) : 'anonymous';
}

function fixFingerprint(packageName: string, summary: string, errorFingerprint?: string): string {
  return shortHash(`${packageName.toLowerCase()}|verified_fix|${errorFingerprint ?? summary.toLowerCase()}`, 20);
}

/**
 * Records the outcome of an applied fix.
 *
 * A failed validation is recorded too, as a refutation — knowing that a fix was
 * tried and did not work is worth as much as knowing that it did.
 */
export async function recordFixOutcome(report: FixReport): Promise<FeedbackResult> {
  const store = report.store ?? getStore();
  const ecosystem = report.ecosystem ?? detectEcosystem(report.package, 'nodejs');
  const succeeded = validationSucceeded(report.validation);
  const now = new Date().toISOString();

  const errorFingerprint = report.error
    ? fingerprintError({
        package: report.package,
        version: report.version,
        error: report.error,
        stackTrace: report.stackTrace,
      }).fingerprint
    : undefined;

  const reinforced = await reinforce(store, report.derivedFrom ?? [], succeeded, report.repository);

  const fingerprint = fixFingerprint(report.package, report.summary, errorFingerprint);
  const existing = await store.findByFingerprint(report.package, fingerprint);

  const priorValidation = existing?.validation;
  const reporter = repositoryKey(report.repository);
  // A repository that already reported this outcome must not be able to inflate
  // confidence by reporting it again.
  const isRepeatReporter = priorValidation?.notes?.includes(reporter) ?? false;

  const validation: ValidationRecord = {
    ...report.validation,
    validatedAt: now,
    confirmations: (priorValidation?.confirmations ?? 0) + (succeeded && !isRepeatReporter ? 1 : 0),
    refutations: (priorValidation?.refutations ?? 0) + (!succeeded && !isRepeatReporter ? 1 : 0),
    notes: [priorValidation?.notes, `${reporter}:${succeeded ? 'pass' : 'fail'}`].filter(Boolean).join(' '),
  };

  const source: SourceRef = {
    url: `upgrade-intel://verified-fix/${fingerprint}`,
    domain: 'upgrade-intel.local',
    sourceType: 'verified_fix',
    trustScore: 0.5,
    retrievedAt: now,
    contentHash: shortHash(JSON.stringify(report.fix), 32),
    title: `Verified fix: ${report.summary}`,
    quotedText: report.validation.notes,
  };

  const officialAgreement = await officialSourceTypes(store, report.derivedFrom ?? []);
  const anchor = await fixAnchor(store, report);

  const confidence = scoreConfidence({
    sourceTypes: ['verified_fix', ...officialAgreement],
    independentDomains: 1,
    exactErrorMatch: Boolean(errorFingerprint),
    exactVersionMatch: Boolean(report.version),
    validated: succeeded,
    provenance: succeeded ? 'verified_repository' : 'agent_generated',
    additionalConfirmations: Math.max(0, validation.confirmations - 1),
    refutations: validation.refutations,
  });

  const knowledge: KnowledgeObject = {
    id: existing?.id ?? `k_${fingerprint}`,
    type: 'error_solution',
    package: report.package,
    ecosystem,
    fromVersion: report.previousVersion,
    toVersion: report.version,
    introduced: anchor,
    affected: affectedRange(anchor),
    title: report.summary,
    description: describeOutcome(report, succeeded),
    summary: report.summary,
    affectedApis: [],
    affectedConfig: [],
    migration: report.fix,
    severity: 'MEDIUM',
    provenance: succeeded ? 'verified_repository' : 'agent_generated',
    sources: [source],
    confidence: confidence.score,
    fingerprint,
    derivedFrom: report.derivedFrom,
    validation,
    errorFingerprint,
    embedding: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  // patch() rather than upsert() when the record exists: a refutation must be able
  // to lower confidence, which upsert's max() would silently discard.
  const recorded = existing
    ? await store.patch(existing.id, knowledge)
    : ((await store.upsert([knowledge])), knowledge);

  return {
    recorded,
    succeeded,
    reinforced,
    message: succeeded
      ? `Recorded a verified fix for ${report.package} (confidence ${confidence.score.toFixed(2)}${
          confidence.cappedBy ? `, capped: ${confidence.cappedBy}` : ''
        }).`
      : `Recorded a failed fix attempt for ${report.package}. It will now rank lower, not higher.`,
  };
}

function describeOutcome(report: FixReport, succeeded: boolean): string {
  const checks = Object.entries(report.validation)
    .filter(([key, value]) => key !== 'notes' && value)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');

  const preamble = succeeded
    ? `Applied to a repository using ${report.package}${report.version ? ` ${report.version}` : ''} and validated (${checks}).`
    : `Applied to a repository using ${report.package}${report.version ? ` ${report.version}` : ''} but validation did not pass (${checks}).`;

  return [preamble, report.error ? `Reported for error: ${report.error.slice(0, 300)}` : null, report.validation.notes]
    .filter(Boolean)
    .join('\n');
}

/** Source types of the knowledge an agent acted on, so real documentation can lift the ceiling. */
/**
 * The version a verified fix applies *from*.
 *
 * Anchoring it to `report.version` is what the reporter happened to be running,
 * which is the wrong question. A fix for chalk's pure-ESM break reported from
 * 5.6.2 was stored as `>=5.6.2`, so anyone on 5.0.0 through 5.6.1 — everybody
 * still stuck on the break — was filtered out of their own answer. Writing back
 * worked; reading back never did.
 *
 * The cause knows where the problem starts, so ask it: the earliest version among
 * the knowledge the agent cited. With nothing cited, fall back to the major
 * boundary, which is where a breaking change has to have been introduced. That
 * can be wider than the truth, but an over-broad match on an agent-authored
 * record capped at 0.6 confidence costs far less than an invisible one.
 */
async function fixAnchor(store: KnowledgeStore, report: FixReport): Promise<string | undefined> {
  const candidates: string[] = [];

  for (const id of report.derivedFrom ?? []) {
    const cause = await store.get(id);
    const from = cause?.introduced ?? (cause?.affected ? coerce(cause.affected.split(/\s+/)[0]) : undefined);
    if (from && parse(from)) candidates.push(from);
  }

  if (candidates.length > 0) return sortVersionsAscending(candidates)[0];

  if (!report.version) return undefined;

  const parsed = parse(coerce(report.version));
  return parsed ? `${parsed.major}.0.0` : report.version;
}

async function officialSourceTypes(store: KnowledgeStore, ids: string[]) {
  const types = new Set<SourceRef['sourceType']>();

  for (const id of ids) {
    const item = await store.get(id);
    for (const source of item?.sources ?? []) {
      if (source.sourceType.startsWith('official')) types.add(source.sourceType);
    }
  }

  return [...types];
}

/**
 * Moves the confidence of knowledge that an agent acted on.
 *
 * Success adds the "Successful validation" signal from gen.md section 21; failure
 * marks it contradicted. Only knowledge the agent explicitly cited is touched.
 */
async function reinforce(
  store: KnowledgeStore,
  ids: string[],
  succeeded: boolean,
  repository?: string,
): Promise<Array<{ id: string; before: number; after: number }>> {
  const moved: Array<{ id: string; before: number; after: number }> = [];
  const reporter = repositoryKey(repository);

  for (const id of ids) {
    const item = await store.get(id);
    if (!item) continue;

    const prior = item.validation;
    if (prior?.notes?.includes(reporter)) continue; // already counted this reporter

    const validation: ValidationRecord = {
      ...prior,
      validatedAt: new Date().toISOString(),
      confirmations: (prior?.confirmations ?? 0) + (succeeded ? 1 : 0),
      refutations: (prior?.refutations ?? 0) + (succeeded ? 0 : 1),
      notes: [prior?.notes, `${reporter}:${succeeded ? 'pass' : 'fail'}`].filter(Boolean).join(' '),
    };

    const rescored = scoreConfidence({
      sourceTypes: item.sources.map((source) => source.sourceType),
      independentDomains: new Set(item.sources.map((source) => source.domain)).size,
      exactVersionMatch: Boolean(item.introduced && item.introduced === item.toVersion),
      validated: validation.confirmations > 0,
      contradicted: validation.refutations > 0,
      provenance: item.provenance,
      additionalConfirmations: Math.max(0, validation.confirmations - 1),
      refutations: validation.refutations,
    });

    await store.patch(id, { validation, confidence: rescored.score });
    moved.push({ id, before: item.confidence, after: rescored.score });
  }

  return moved;
}
