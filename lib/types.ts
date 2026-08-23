export type Ecosystem = 'nodejs' | 'python' | 'langchain' | 'llamaindex' | 'aiml';

export interface Dependency {
  name: string;
  currentVersion: string;
  targetVersion: string;
  ecosystem: Ecosystem;
  repoUrl?: string;
  docsUrl?: string;
  changelogUrl?: string;
}

export interface ManifestParseResult {
  ecosystem: Ecosystem;
  fileName: string;
  dependencies: Dependency[];
  totalCount: number;
}

/** How a source was retrieved. */
export type SourceTransport = 'brightdata' | 'direct' | 'cache' | 'api';

export interface ResearchedSource {
  /** Version this source documents, when the engine could anchor one. */
  version: string;
  publishedAt?: string;
  title: string;
  /**
   * Change claims extracted from this source.
   *
   * Not raw HTML: the engine normalizes every document before storing it, so
   * what reaches the UI is already structured knowledge.
   */
  extractedClaims: string[];
  sourceUrl: string;
  /** Authority tier assigned by the source ladder, e.g. `official_release`. */
  sourceType: string;
  transport: SourceTransport;
}

export interface BreakingChangeItem {
  id: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'REMOVED_API' | 'SIGNATURE_CHANGE' | 'DEFAULT_BEHAVIOR' | 'DEPRECATION' | 'DEPENDENCY_CONFLICT' | 'SECURITY';
  title: string;
  description: string;
  affectedSymbols: string[];
  beforeSnippet?: string;
  afterSnippet?: string;
  citation: {
    url: string;
    title: string;
    sectionAnchor?: string;
    quotedText: string;
  };
}

export interface DependencyRiskReport {
  dependency: Dependency;
  overallRiskScore: number; // 0 to 100
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';
  breakingChanges: BreakingChangeItem[];
  sources: ResearchedSource[];
  research: {
    sourcesFetched: number;
    /** Total knowledge objects indexed for this package, breaking or otherwise. */
    knowledgeExtracted: number;
    /** True when existing index coverage answered without any fetching. */
    servedFromIndex: boolean;
    /** Highest-authority source actually read. Empty when nothing was retrieved. */
    primaryUrl: string;
    failures: number;
  };
}

export interface FullBlastRadiusAnalysis {
  id: string;
  createdAt: string;
  ecosystem: Ecosystem;
  totalDependencies: number;
  totalBreakingChanges: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  overallSafetyRating: 'HIGH_RISK' | 'MODERATE_RISK' | 'LOW_RISK' | 'SAFE_TO_UPGRADE';
  reports: DependencyRiskReport[];
  researchSummary: {
    totalSourcesFetched: number;
    /**
     * Sources that needed the Bright Data unlocker rather than a direct fetch.
     *
     * This replaced a "self-healed scrapers" count that described something the
     * engine never did. The number is real; the old label was not.
     */
    unlockedSourceCount: number;
    cacheHits: number;
    /** One line per source read or fetch attempted, for the monitor view. */
    trace: string[];
  };
}
