/**
 * Argument, return and document validators.
 *
 * Convex validates every public function boundary and every stored document, and
 * the engine already has TypeScript types for all of this in `lib/engine`. Rather
 * than let the two drift, the assertions at the bottom of this file fail the
 * typecheck the moment a validator stops describing the engine type it mirrors.
 */

import { v, type Infer } from 'convex/values';

import type { RiskAssessment, RiskLevel, SafetyRating, VersionChange } from '../lib/engine/analysis/versionDiff';
import type {
  Ecosystem,
  KnowledgeObject,
  KnowledgeType,
  MigrationStep,
  Provenance,
  Severity,
  SourceRef,
  SourceType,
  ValidationRecord,
} from '../lib/engine/knowledge';
import type { ConfidenceCategory } from '../lib/engine/analysis/confidence';
import type { ErrorResolution, ErrorResolutionTrace, EvidenceItem } from '../lib/engine/errorPipeline';
import type { ErrorFingerprint } from '../lib/engine/knowledge';
import type { GraphEdge, GraphNode } from '../lib/engine/index/graph';
import type { RankingSignals, SearchQuery } from '../lib/engine/index/ranking';
import type {
  BreakingChangeItem,
  Dependency,
  DependencyRiskReport,
  FullBlastRadiusAnalysis,
  ResearchedSource,
} from '../lib/types';
import type { ResearchTrace } from '../lib/engine/pipeline';
import type { VersionDelta } from '../lib/engine/semver';

export const ecosystem = v.union(
  v.literal('nodejs'),
  v.literal('python'),
  v.literal('langchain'),
  v.literal('llamaindex'),
  v.literal('aiml'),
);

export const knowledgeType = v.union(
  v.literal('breaking_change'),
  v.literal('deprecated_api'),
  v.literal('removed_api'),
  v.literal('renamed_api'),
  v.literal('new_api'),
  v.literal('configuration_change'),
  v.literal('environment_change'),
  v.literal('cli_change'),
  v.literal('runtime_requirement'),
  v.literal('dependency_requirement'),
  v.literal('bug_fix'),
  v.literal('security_fix'),
  v.literal('performance_change'),
  v.literal('behavior_change'),
  v.literal('error_solution'),
  v.literal('migration_example'),
  v.literal('github_issue'),
  v.literal('github_commit'),
  v.literal('release_note'),
);

export const sourceType = v.union(
  v.literal('official_migration_guide'),
  v.literal('official_docs'),
  v.literal('official_changelog'),
  v.literal('official_release'),
  v.literal('official_commit'),
  v.literal('official_issue'),
  v.literal('package_registry'),
  v.literal('technical_docs'),
  v.literal('community'),
  v.literal('web'),
  v.literal('verified_fix'),
);

export const severity = v.union(v.literal('CRITICAL'), v.literal('HIGH'), v.literal('MEDIUM'), v.literal('LOW'));

export const provenance = v.union(
  v.literal('official'),
  v.literal('community'),
  v.literal('agent_generated'),
  v.literal('verified_repository'),
);

export const checkOutcome = v.union(v.literal('passed'), v.literal('failed'), v.literal('skipped'));

export const transport = v.union(
  v.literal('brightdata'),
  v.literal('direct'),
  v.literal('cache'),
  // A structured endpoint stood in for the page it is cited as.
  v.literal('api'),
  // An unlocker fetch that spent the deployment's key rather than the caller's.
  v.literal('relay'),
);

export const sourceRef = v.object({
  url: v.string(),
  retrievalUrl: v.optional(v.string()),
  domain: v.string(),
  sourceType,
  trustScore: v.number(),
  retrievedAt: v.string(),
  contentHash: v.string(),
  title: v.optional(v.string()),
  publishedAt: v.optional(v.string()),
  sectionAnchor: v.optional(v.string()),
  quotedText: v.optional(v.string()),
});

export const migrationStep = v.object({
  kind: v.union(
    v.literal('replace'),
    v.literal('install'),
    v.literal('remove'),
    v.literal('run'),
    v.literal('config'),
    v.literal('manual'),
  ),
  description: v.string(),
  before: v.optional(v.string()),
  after: v.optional(v.string()),
  language: v.optional(v.string()),
});

export const validationRecord = v.object({
  tests: v.optional(checkOutcome),
  typecheck: v.optional(checkOutcome),
  build: v.optional(checkOutcome),
  notes: v.optional(v.string()),
  validatedAt: v.string(),
  confirmations: v.number(),
  refutations: v.number(),
});

/**
 * The shared half of a knowledge object.
 *
 * Split out from `knowledgeObject` because the stored document differs from the
 * wire shape in exactly two ways: the embedding is absent rather than null (a
 * vector index cannot index nulls) and the document carries denormalized
 * `packageKey` / `text` fields for the indexes.
 */
const knowledgeCore = {
  id: v.string(),
  type: knowledgeType,
  package: v.string(),
  ecosystem,

  fromVersion: v.optional(v.string()),
  toVersion: v.optional(v.string()),
  introduced: v.optional(v.string()),
  fixed: v.optional(v.string()),
  affected: v.optional(v.string()),

  title: v.string(),
  description: v.string(),
  summary: v.optional(v.string()),
  oldBehavior: v.optional(v.string()),
  newBehavior: v.optional(v.string()),

  affectedApis: v.array(v.string()),
  affectedConfig: v.array(v.string()),
  migration: v.array(migrationStep),

  severity,
  provenance,
  sources: v.array(sourceRef),
  confidence: v.number(),

  fingerprint: v.string(),
  derivedFrom: v.optional(v.array(v.string())),
  validation: v.optional(validationRecord),
  errorFingerprint: v.optional(v.string()),
  /**
   * Which embedder produced the vector. Vectors from different models are not
   * comparable, so a mismatch means the stored one is stale.
   */
  embeddingModel: v.optional(v.string()),

  createdAt: v.string(),
  updatedAt: v.string(),
};

/** A knowledge object as it crosses a function boundary — the engine's own shape. */
export const knowledgeObject = v.object({
  ...knowledgeCore,
  embedding: v.union(v.null(), v.array(v.float64())),
});

/** A knowledge object as it is stored. See `knowledgeCore` for how the two differ. */
export const knowledgeDocument = {
  ...knowledgeCore,
  /** Lowercased package name: the only form the equality indexes are queried by. */
  packageKey: v.string(),
  /** Denormalized `knowledgeText()` output, so the full-text index has one field to read. */
  text: v.string(),
  /** Absent until an embedder has run over this entry. */
  embedding: v.optional(v.array(v.float64())),
};

/**
 * A partial update to one entry.
 *
 * Written out rather than derived from `knowledgeCore` so the literal unions
 * survive; the assertions at the bottom keep it honest against
 * `Partial<KnowledgeObject>`.
 */
export const knowledgePatch = v.object({
  type: v.optional(knowledgeType),
  package: v.optional(v.string()),
  ecosystem: v.optional(ecosystem),
  fromVersion: v.optional(v.string()),
  toVersion: v.optional(v.string()),
  introduced: v.optional(v.string()),
  fixed: v.optional(v.string()),
  affected: v.optional(v.string()),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  summary: v.optional(v.string()),
  oldBehavior: v.optional(v.string()),
  newBehavior: v.optional(v.string()),
  affectedApis: v.optional(v.array(v.string())),
  affectedConfig: v.optional(v.array(v.string())),
  migration: v.optional(v.array(migrationStep)),
  severity: v.optional(severity),
  provenance: v.optional(provenance),
  sources: v.optional(v.array(sourceRef)),
  confidence: v.optional(v.number()),
  derivedFrom: v.optional(v.array(v.string())),
  validation: v.optional(validationRecord),
  errorFingerprint: v.optional(v.string()),
  embedding: v.optional(v.union(v.null(), v.array(v.float64()))),
  embeddingModel: v.optional(v.string()),
  createdAt: v.optional(v.string()),
  updatedAt: v.optional(v.string()),
});

export const rankingSignals = v.object({
  lexical: v.number(),
  semantic: v.number(),
  exactErrorMatch: v.number(),
  packageMatch: v.number(),
  versionMatch: v.number(),
  authority: v.number(),
  recency: v.number(),
  documentType: v.number(),
});

export const scoredKnowledge = v.object({
  knowledge: knowledgeObject,
  score: v.number(),
  signals: rankingSignals,
});

export const searchQuery = {
  text: v.optional(v.string()),
  package: v.optional(v.string()),
  ecosystem: v.optional(ecosystem),
  version: v.optional(v.string()),
  types: v.optional(v.array(knowledgeType)),
  minConfidence: v.optional(v.number()),
  errorType: v.optional(v.string()),
  limit: v.optional(v.number()),
  embedding: v.optional(v.union(v.null(), v.array(v.float64()))),
};

export const versionDelta = v.union(
  v.literal('major'),
  v.literal('minor'),
  v.literal('patch'),
  v.literal('prerelease'),
  v.literal('none'),
  v.literal('downgrade'),
  v.literal('unknown'),
);

export const dependencyType = v.union(
  v.literal('dependencies'),
  v.literal('devDependencies'),
  v.literal('peerDependencies'),
  v.literal('optionalDependencies'),
);

export const versionChange = v.object({
  package: v.string(),
  fromVersion: v.string(),
  toVersion: v.union(v.null(), v.string()),
  delta: versionDelta,
  breakingByPolicy: v.boolean(),
  dependencyType,
});

export const riskLevel = v.union(
  v.literal('CRITICAL'),
  v.literal('HIGH'),
  v.literal('MEDIUM'),
  v.literal('LOW'),
  v.literal('SAFE'),
);

export const riskAssessment = v.object({
  score: v.number(),
  level: riskLevel,
  rationale: v.array(v.string()),
});

export const safetyRating = v.union(
  v.literal('HIGH_RISK'),
  v.literal('MODERATE_RISK'),
  v.literal('LOW_RISK'),
  v.literal('SAFE_TO_UPGRADE'),
);

export const researchTrace = v.object({
  planned: v.number(),
  fetched: v.array(
    v.object({
      url: v.string(),
      sourceType,
      title: v.string(),
      transport,
      fromCache: v.boolean(),
      extracted: v.number(),
    }),
  ),
  failures: v.array(v.object({ url: v.string(), reason: v.string() })),
  cacheHits: v.number(),
  extractedBeforeDedupe: v.number(),
  collapsedByDedupe: v.number(),
  contradictions: v.number(),
  usedSearch: v.boolean(),
  servedFromIndex: v.boolean(),
});

/**
 * Registry metadata worth keeping.
 *
 * `PackageMetadata.versions` is deliberately not stored: it is every version a
 * package ever published, it can run to thousands of strings, and nothing that
 * reads an analysis back needs it.
 */
export const packageLinks = v.object({
  name: v.string(),
  ecosystem,
  latestVersion: v.union(v.null(), v.string()),
  registryUrl: v.string(),
  repositoryUrl: v.optional(v.string()),
  githubSlug: v.optional(v.string()),
  homepage: v.optional(v.string()),
  documentationUrl: v.optional(v.string()),
  changelogUrl: v.optional(v.string()),
  description: v.optional(v.string()),
  deprecated: v.optional(v.string()),
});

export const analysisStatus = v.union(
  v.literal('pending'),
  v.literal('running'),
  v.literal('complete'),
  v.literal('failed'),
);

export const packageStatus = v.union(
  v.literal('pending'),
  v.literal('researching'),
  v.literal('done'),
  v.literal('failed'),
);

export const packageRef = v.object({
  name: v.string(),
  ecosystem,
  currentVersion: v.string(),
  targetVersion: v.optional(v.string()),
  dependencyType,
  specifier: v.string(),
});

/** The legacy view-model dependency the UI reads (`lib/types.ts`). */
export const dependency = v.object({
  name: v.string(),
  currentVersion: v.string(),
  targetVersion: v.string(),
  ecosystem,
  repoUrl: v.optional(v.string()),
  docsUrl: v.optional(v.string()),
  changelogUrl: v.optional(v.string()),
});

export const confidenceCategory = v.union(
  v.literal('Very High'),
  v.literal('High'),
  v.literal('Medium'),
  v.literal('Low'),
  v.literal('Very Low'),
);

export const errorFingerprint = v.object({
  package: v.string(),
  packageVersion: v.optional(v.string()),
  errorType: v.string(),
  errorCode: v.optional(v.string()),
  message: v.string(),
  normalizedMessage: v.string(),
  stackSymbols: v.array(v.string()),
  environment: v.record(v.string(), v.string()),
  fingerprint: v.string(),
});

export const evidenceItem = v.object({
  knowledgeId: v.string(),
  type: knowledgeType,
  title: v.string(),
  url: v.string(),
  sourceType: v.string(),
  quotedText: v.optional(v.string()),
  confidence: v.number(),
  appliesToVersion: v.boolean(),
});

export const errorResolutionTrace = v.object({
  indexHits: v.number(),
  servedFromIndex: v.boolean(),
  queriesRun: v.array(v.object({ label: v.string(), query: v.string(), results: v.number() })),
  issuesSearched: v.number(),
  documentsFetched: v.number(),
  knowledgeIndexed: v.number(),
  searchUnavailable: v.boolean(),
});

export const errorResolution = v.object({
  fingerprint: errorFingerprint,
  diagnosis: v.string(),
  likelyCause: v.union(v.null(), v.string()),
  fix: v.array(migrationStep),
  affectedVersions: v.array(v.string()),
  fixedVersions: v.array(v.string()),
  repositoryImpact: v.array(v.string()),
  confidence: v.number(),
  confidenceCategory,
  caveat: v.union(v.null(), v.string()),
  evidence: v.array(evidenceItem),
  trace: errorResolutionTrace,
});

/**
 * The blast-radius view model (`lib/types.ts`).
 *
 * The UI reads this shape, so it is a contract in its own right — worth
 * validating on the way out even though nothing but a query produces it.
 */
export const researchedSource = v.object({
  version: v.string(),
  publishedAt: v.optional(v.string()),
  title: v.string(),
  extractedClaims: v.array(v.string()),
  sourceUrl: v.string(),
  sourceType: v.string(),
  transport,
});

export const breakingChangeItem = v.object({
  id: v.string(),
  packageName: v.string(),
  fromVersion: v.string(),
  toVersion: v.string(),
  severity,
  category: v.union(
    v.literal('REMOVED_API'),
    v.literal('SIGNATURE_CHANGE'),
    v.literal('DEFAULT_BEHAVIOR'),
    v.literal('DEPRECATION'),
    v.literal('DEPENDENCY_CONFLICT'),
    v.literal('SECURITY'),
  ),
  title: v.string(),
  description: v.string(),
  affectedSymbols: v.array(v.string()),
  beforeSnippet: v.optional(v.string()),
  afterSnippet: v.optional(v.string()),
  citation: v.object({
    url: v.string(),
    title: v.string(),
    sectionAnchor: v.optional(v.string()),
    quotedText: v.string(),
  }),
});

export const dependencyRiskReport = v.object({
  dependency,
  overallRiskScore: v.number(),
  riskLevel,
  breakingChanges: v.array(breakingChangeItem),
  sources: v.array(researchedSource),
  research: v.object({
    sourcesFetched: v.number(),
    knowledgeExtracted: v.number(),
    servedFromIndex: v.boolean(),
    primaryUrl: v.string(),
    failures: v.number(),
  }),
});

export const blastRadiusAnalysis = v.object({
  id: v.string(),
  createdAt: v.string(),
  ecosystem,
  totalDependencies: v.number(),
  totalBreakingChanges: v.number(),
  criticalCount: v.number(),
  highCount: v.number(),
  mediumCount: v.number(),
  lowCount: v.number(),
  overallSafetyRating: safetyRating,
  reports: v.array(dependencyRiskReport),
  researchSummary: v.object({
    totalSourcesFetched: v.number(),
    unlockedSourceCount: v.number(),
    cacheHits: v.number(),
    trace: v.array(v.string()),
  }),
});

/** The knowledge graph (gen.md section 10). */
export const graphNode = v.object({
  id: v.string(),
  type: v.union(
    v.literal('package'),
    v.literal('version'),
    v.literal('release'),
    v.literal('breaking_change'),
    v.literal('change'),
    v.literal('api'),
    v.literal('error'),
    v.literal('issue'),
    v.literal('commit'),
    v.literal('migration'),
    v.literal('documentation'),
  ),
  label: v.string(),
  knowledge: v.array(v.string()),
  version: v.optional(v.string()),
  package: v.optional(v.string()),
  url: v.optional(v.string()),
  severity: v.optional(severity),
  confidence: v.optional(v.number()),
  knowledgeType: v.optional(knowledgeType),
});

export const graphEdge = v.object({
  from: v.string(),
  to: v.string(),
  relation: v.union(
    v.literal('HAS_VERSION'),
    v.literal('HAS_RELEASE'),
    v.literal('INTRODUCES'),
    v.literal('AFFECTS'),
    v.literal('FIXED_BY'),
    v.literal('RELATED_TO'),
    v.literal('RESOLVED_BY'),
    v.literal('DOCUMENTED_BY'),
    v.literal('REQUIRES'),
  ),
  knowledgeId: v.optional(v.string()),
});

/** Object forms of the field maps above, for `Infer` and for nested reuse. */
export const knowledgeDocumentObject = v.object(knowledgeDocument);
export const searchQueryObject = v.object(searchQuery);

export type KnowledgeDoc = Infer<typeof knowledgeDocumentObject>;

/**
 * Compile-time conformance.
 *
 * `AssertAssignable` is instantiated below in both directions for every
 * validator that mirrors an engine type, so a change on either side that breaks
 * the correspondence is a typecheck failure rather than a runtime surprise.
 */
type AssertAssignable<A extends B, B> = A;

/* eslint-disable @typescript-eslint/no-unused-vars -- these exist to be checked, not used */

type _Ecosystem = [AssertAssignable<Infer<typeof ecosystem>, Ecosystem>, AssertAssignable<Ecosystem, Infer<typeof ecosystem>>];
type _KnowledgeType = [
  AssertAssignable<Infer<typeof knowledgeType>, KnowledgeType>,
  AssertAssignable<KnowledgeType, Infer<typeof knowledgeType>>,
];
type _SourceType = [
  AssertAssignable<Infer<typeof sourceType>, SourceType>,
  AssertAssignable<SourceType, Infer<typeof sourceType>>,
];
type _Severity = [AssertAssignable<Infer<typeof severity>, Severity>, AssertAssignable<Severity, Infer<typeof severity>>];
type _Provenance = [
  AssertAssignable<Infer<typeof provenance>, Provenance>,
  AssertAssignable<Provenance, Infer<typeof provenance>>,
];
type _SourceRef = [
  AssertAssignable<Infer<typeof sourceRef>, SourceRef>,
  AssertAssignable<SourceRef, Infer<typeof sourceRef>>,
];
type _MigrationStep = [
  AssertAssignable<Infer<typeof migrationStep>, MigrationStep>,
  AssertAssignable<MigrationStep, Infer<typeof migrationStep>>,
];
type _ValidationRecord = [
  AssertAssignable<Infer<typeof validationRecord>, ValidationRecord>,
  AssertAssignable<ValidationRecord, Infer<typeof validationRecord>>,
];
type _KnowledgeObject = [
  AssertAssignable<Infer<typeof knowledgeObject>, KnowledgeObject>,
  AssertAssignable<KnowledgeObject, Infer<typeof knowledgeObject>>,
];
type _KnowledgePatch = [
  AssertAssignable<Infer<typeof knowledgePatch>, Partial<KnowledgeObject>>,
  AssertAssignable<Omit<Partial<KnowledgeObject>, 'id' | 'fingerprint'>, Infer<typeof knowledgePatch>>,
];
type _RankingSignals = [
  AssertAssignable<Infer<typeof rankingSignals>, RankingSignals>,
  AssertAssignable<RankingSignals, Infer<typeof rankingSignals>>,
];
type _SearchQuery = AssertAssignable<Infer<typeof searchQueryObject>, SearchQuery>;
type _VersionDelta = [
  AssertAssignable<Infer<typeof versionDelta>, VersionDelta>,
  AssertAssignable<VersionDelta, Infer<typeof versionDelta>>,
];
type _VersionChange = [
  AssertAssignable<Infer<typeof versionChange>, VersionChange>,
  AssertAssignable<VersionChange, Infer<typeof versionChange>>,
];
type _RiskLevel = [AssertAssignable<Infer<typeof riskLevel>, RiskLevel>, AssertAssignable<RiskLevel, Infer<typeof riskLevel>>];
type _RiskAssessment = [
  AssertAssignable<Infer<typeof riskAssessment>, RiskAssessment>,
  AssertAssignable<RiskAssessment, Infer<typeof riskAssessment>>,
];
type _SafetyRating = [
  AssertAssignable<Infer<typeof safetyRating>, SafetyRating>,
  AssertAssignable<SafetyRating, Infer<typeof safetyRating>>,
];
type _ResearchTrace = [
  AssertAssignable<Infer<typeof researchTrace>, ResearchTrace>,
  AssertAssignable<ResearchTrace, Infer<typeof researchTrace>>,
];
type _Dependency = [
  AssertAssignable<Infer<typeof dependency>, Dependency>,
  AssertAssignable<Dependency, Infer<typeof dependency>>,
];
type _ResearchedSource = [
  AssertAssignable<Infer<typeof researchedSource>, ResearchedSource>,
  AssertAssignable<ResearchedSource, Infer<typeof researchedSource>>,
];
type _BreakingChangeItem = [
  AssertAssignable<Infer<typeof breakingChangeItem>, BreakingChangeItem>,
  AssertAssignable<BreakingChangeItem, Infer<typeof breakingChangeItem>>,
];
type _DependencyRiskReport = [
  AssertAssignable<Infer<typeof dependencyRiskReport>, DependencyRiskReport>,
  AssertAssignable<DependencyRiskReport, Infer<typeof dependencyRiskReport>>,
];
type _BlastRadiusAnalysis = [
  AssertAssignable<Infer<typeof blastRadiusAnalysis>, FullBlastRadiusAnalysis>,
  AssertAssignable<FullBlastRadiusAnalysis, Infer<typeof blastRadiusAnalysis>>,
];
type _ConfidenceCategory = [
  AssertAssignable<Infer<typeof confidenceCategory>, ConfidenceCategory>,
  AssertAssignable<ConfidenceCategory, Infer<typeof confidenceCategory>>,
];
type _ErrorFingerprint = [
  AssertAssignable<Infer<typeof errorFingerprint>, ErrorFingerprint>,
  AssertAssignable<ErrorFingerprint, Infer<typeof errorFingerprint>>,
];
type _EvidenceItem = [
  AssertAssignable<Infer<typeof evidenceItem>, EvidenceItem>,
  AssertAssignable<EvidenceItem, Infer<typeof evidenceItem>>,
];
type _ErrorResolutionTrace = [
  AssertAssignable<Infer<typeof errorResolutionTrace>, ErrorResolutionTrace>,
  AssertAssignable<ErrorResolutionTrace, Infer<typeof errorResolutionTrace>>,
];
type _ErrorResolution = [
  AssertAssignable<Infer<typeof errorResolution>, ErrorResolution>,
  AssertAssignable<ErrorResolution, Infer<typeof errorResolution>>,
];
type _GraphNode = [AssertAssignable<Infer<typeof graphNode>, GraphNode>, AssertAssignable<GraphNode, Infer<typeof graphNode>>];
type _GraphEdge = [AssertAssignable<Infer<typeof graphEdge>, GraphEdge>, AssertAssignable<GraphEdge, Infer<typeof graphEdge>>];
/* eslint-enable @typescript-eslint/no-unused-vars */
