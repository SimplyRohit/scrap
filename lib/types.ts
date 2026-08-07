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

export interface ScrapedReleaseItem {
  version: string;
  releaseDate?: string;
  title: string;
  rawContent: string;
  sourceUrl: string;
  collectorId: string;
  wasSelfHealed: boolean;
  healEnvelope?: {
    originalSchema: string[];
    healedSchema: string[];
    reason: string;
    timestamp: string;
  };
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
  scrapedReleases: ScrapedReleaseItem[];
  collectorStatus: {
    collectorId: string;
    status: 'active' | 'healed' | 'complete';
    scrapedUrl: string;
    fieldsExtracted: number;
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
  selfHealingSummary: {
    totalScrapersDeployed: number;
    healedScraperCount: number;
    schemaAdaptations: string[];
  };
}
