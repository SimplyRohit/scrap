/**
 * The canonical knowledge representation (gen.md sections 6, 9, 11).
 *
 * Everything the engine learns becomes a `KnowledgeObject`. Markdown, the blast
 * radius UI, and agent payloads are all *projections* of these — never the other
 * way around. Raw scraped HTML is an input to normalization and is never stored
 * as primary knowledge.
 */

import { affectedRange } from './semver';

export type Ecosystem = 'nodejs' | 'python' | 'langchain' | 'llamaindex' | 'aiml';

/** gen.md section 6. */
export type KnowledgeType =
  | 'breaking_change'
  | 'deprecated_api'
  | 'removed_api'
  | 'renamed_api'
  | 'new_api'
  | 'configuration_change'
  | 'environment_change'
  | 'cli_change'
  | 'runtime_requirement'
  | 'dependency_requirement'
  | 'bug_fix'
  | 'security_fix'
  | 'performance_change'
  | 'behavior_change'
  | 'error_solution'
  | 'migration_example'
  | 'github_issue'
  | 'github_commit'
  | 'release_note';

/**
 * Ordered by authority — index equals priority rank in gen.md section 5.
 *
 * `verified_fix` extends that ladder for knowledge the system produced itself:
 * a migration an agent applied and then proved by running the test suite. It sits
 * last because it is evidence about one repository, not a statement from the
 * package's authors — see gen.md section 20.
 */
export const SOURCE_PRIORITY = [
  'official_migration_guide',
  'official_docs',
  'official_changelog',
  'official_release',
  'official_commit',
  'official_issue',
  'package_registry',
  'technical_docs',
  'community',
  'web',
  'verified_fix',
] as const;

export type SourceType = (typeof SOURCE_PRIORITY)[number];

/**
 * Where knowledge came from. Kept separate from `SourceType` because it gates
 * trust escalation: agent-generated fixes must not inherit official trust
 * (gen.md section 20).
 */
export type Provenance = 'official' | 'community' | 'agent_generated' | 'verified_repository';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface SourceRef {
  url: string;
  domain: string;
  sourceType: SourceType;
  /** Baseline authority of the source itself, before per-claim evidence scoring. */
  trustScore: number;
  retrievedAt: string;
  contentHash: string;
  title?: string;
  publishedAt?: string;
  sectionAnchor?: string;
  /** Verbatim text supporting the claim. Required for a citation to be shown. */
  quotedText?: string;
}

export type MigrationStepKind = 'replace' | 'install' | 'remove' | 'run' | 'config' | 'manual';

export interface MigrationStep {
  kind: MigrationStepKind;
  description: string;
  before?: string;
  after?: string;
  language?: string;
}

export interface KnowledgeObject {
  id: string;
  type: KnowledgeType;
  package: string;
  ecosystem: Ecosystem;

  /** Version window this knowledge describes. */
  fromVersion?: string;
  toVersion?: string;
  /** First version exhibiting the change/error. */
  introduced?: string;
  /** First version where it no longer applies. */
  fixed?: string;
  /** Machine-checkable range, e.g. `>=6.0.0 <6.2.1`. Derived from introduced/fixed. */
  affected?: string;

  title: string;
  description: string;
  summary?: string;
  oldBehavior?: string;
  newBehavior?: string;

  affectedApis: string[];
  affectedConfig: string[];
  migration: MigrationStep[];

  severity: Severity;
  provenance: Provenance;
  /** Every source that independently asserts this same knowledge (gen.md section 12). */
  sources: SourceRef[];
  confidence: number;

  /** Stable hash of the normalized claim — the deduplication key. */
  fingerprint: string;
  /** Knowledge ids this was derived from, for agent-produced fixes. */
  derivedFrom?: string[];
  /** Present once a repository has actually run its checks against this. */
  validation?: ValidationRecord;
  /** Error fingerprint this knowledge resolves, when it came from an error report. */
  errorFingerprint?: string;
  /** Phase 2 seam. Null until an embedder is configured; retrieval degrades to lexical. */
  embedding: number[] | null;

  createdAt: string;
  updatedAt: string;
}

export interface ErrorFingerprint {
  package: string;
  packageVersion?: string;
  errorType: string;
  errorCode?: string;
  message: string;
  normalizedMessage: string;
  stackSymbols: string[];
  environment: Record<string, string>;
  fingerprint: string;
}

/** Baseline authority per source type (gen.md section 5 priority ladder). */
export const SOURCE_TRUST: Record<SourceType, number> = {
  official_migration_guide: 0.98,
  official_docs: 0.95,
  official_changelog: 0.92,
  official_release: 0.9,
  official_commit: 0.85,
  official_issue: 0.75,
  package_registry: 0.8,
  technical_docs: 0.6,
  community: 0.4,
  web: 0.25,
  // Proven to work somewhere, but proven only there.
  verified_fix: 0.5,
};

export function sourcePriority(sourceType: SourceType): number {
  return SOURCE_PRIORITY.indexOf(sourceType);
}

export function provenanceOf(sourceType: SourceType): Provenance {
  if (sourceType === 'verified_fix') return 'verified_repository';
  return sourceType.startsWith('official') || sourceType === 'package_registry' ? 'official' : 'community';
}

/** Outcome of running a repository's own checks after applying a fix (gen.md section 20). */
export interface ValidationRecord {
  tests?: 'passed' | 'failed' | 'skipped';
  typecheck?: 'passed' | 'failed' | 'skipped';
  build?: 'passed' | 'failed' | 'skipped';
  /** Free-form note from the agent, e.g. the command that was run. */
  notes?: string;
  validatedAt: string;
  /** How many independent repositories have confirmed this. */
  confirmations: number;
  /** How many times applying it did not resolve the problem. */
  refutations: number;
}

/** A validation counts as successful only if nothing it ran actually failed. */
export function validationSucceeded(record: Pick<ValidationRecord, 'tests' | 'typecheck' | 'build'>): boolean {
  const outcomes = [record.tests, record.typecheck, record.build].filter(Boolean);
  if (outcomes.length === 0) return false;
  return outcomes.every((outcome) => outcome === 'passed' || outcome === 'skipped') && outcomes.includes('passed');
}

/** Severity implied by a knowledge type, before source-specific adjustment. */
const TYPE_SEVERITY: Partial<Record<KnowledgeType, Severity>> = {
  removed_api: 'CRITICAL',
  breaking_change: 'HIGH',
  renamed_api: 'HIGH',
  security_fix: 'HIGH',
  runtime_requirement: 'HIGH',
  dependency_requirement: 'HIGH',
  configuration_change: 'MEDIUM',
  environment_change: 'MEDIUM',
  cli_change: 'MEDIUM',
  behavior_change: 'MEDIUM',
  deprecated_api: 'MEDIUM',
  performance_change: 'LOW',
  bug_fix: 'LOW',
  new_api: 'LOW',
  migration_example: 'LOW',
  release_note: 'LOW',
  github_issue: 'LOW',
  github_commit: 'LOW',
  error_solution: 'MEDIUM',
};

export function severityForType(type: KnowledgeType): Severity {
  return TYPE_SEVERITY[type] ?? 'MEDIUM';
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/** Full text used for lexical indexing and embedding. */
export function knowledgeText(k: KnowledgeObject): string {
  return [
    k.title,
    k.description,
    k.oldBehavior,
    k.newBehavior,
    ...k.affectedApis,
    ...k.affectedConfig,
    ...k.migration.flatMap((m) => [m.description, m.before, m.after]),
    ...k.sources.map((s) => s.quotedText),
  ]
    .filter(Boolean)
    .join('\n');
}

export function withDerivedRange(k: KnowledgeObject): KnowledgeObject {
  return { ...k, affected: k.affected ?? affectedRange(k.introduced ?? k.toVersion, k.fixed) };
}
