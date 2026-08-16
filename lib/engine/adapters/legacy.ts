/**
 * Adapter from engine output to the blast-radius view model (`lib/types.ts`).
 *
 * The view model was renamed to match what the engine actually does. It
 * previously described "self-healing collectors" and "schema envelopes" — events
 * the mock reported and the real engine never performs. Those fields are now
 * `research` / `researchSummary`, carrying the real fetch trace: transport,
 * source authority, cache hits, and claims extracted.
 *
 * Nothing in this file invents a value it did not receive from the pipeline.
 */

import type {
  BreakingChangeItem,
  Dependency,
  DependencyRiskReport,
  FullBlastRadiusAnalysis,
  ResearchedSource,
} from '../../types';
import { isBreaking } from '../analysis/versionDiff';
import type { KnowledgeObject } from '../knowledge';
import type { ManifestResearchResult, PackageResearchResult } from '../pipeline';

const CATEGORY_BY_TYPE: Record<string, BreakingChangeItem['category']> = {
  removed_api: 'REMOVED_API',
  renamed_api: 'SIGNATURE_CHANGE',
  breaking_change: 'SIGNATURE_CHANGE',
  deprecated_api: 'DEPRECATION',
  configuration_change: 'DEFAULT_BEHAVIOR',
  environment_change: 'DEFAULT_BEHAVIOR',
  behavior_change: 'DEFAULT_BEHAVIOR',
  cli_change: 'DEFAULT_BEHAVIOR',
  runtime_requirement: 'DEPENDENCY_CONFLICT',
  dependency_requirement: 'DEPENDENCY_CONFLICT',
  security_fix: 'SECURITY',
};

function toDependency(result: PackageResearchResult): Dependency {
  return {
    name: result.package,
    currentVersion: result.change.fromVersion,
    targetVersion: result.change.toVersion ?? result.change.fromVersion,
    ecosystem: result.ecosystem,
    repoUrl: result.metadata?.repositoryUrl,
    docsUrl: result.metadata?.documentationUrl ?? result.metadata?.homepage ?? result.metadata?.registryUrl,
    changelogUrl: result.metadata?.changelogUrl,
  };
}

function toBreakingChange(knowledge: KnowledgeObject, result: PackageResearchResult): BreakingChangeItem {
  const primary = knowledge.sources[0];
  const step = knowledge.migration.find((item) => item.before || item.after);

  return {
    id: knowledge.id,
    packageName: knowledge.package,
    fromVersion: knowledge.fromVersion ?? result.change.fromVersion,
    toVersion: knowledge.introduced ?? knowledge.toVersion ?? result.change.toVersion ?? '',
    severity: knowledge.severity,
    category: CATEGORY_BY_TYPE[knowledge.type] ?? 'DEFAULT_BEHAVIOR',
    title: knowledge.title,
    description: knowledge.description,
    affectedSymbols: knowledge.affectedApis,
    beforeSnippet: step?.before,
    afterSnippet: step?.after,
    citation: {
      url: primary?.url ?? '',
      title: primary?.title ?? primary?.domain ?? 'source',
      sectionAnchor: primary?.sectionAnchor,
      // The UI renders this as the supporting quote; an empty string is honest
      // when the source gave us no quotable line.
      quotedText: primary?.quotedText ?? '',
    },
  };
}

function toResearchedSources(result: PackageResearchResult): ResearchedSource[] {
  return result.trace.fetched.map((source) => {
    const claims = result.knowledge.filter((item) => item.sources.some((ref) => ref.url === source.url));

    return {
      version: result.change.toVersion ?? result.change.fromVersion,
      publishedAt: claims[0]?.sources.find((ref) => ref.url === source.url)?.publishedAt,
      title: source.title,
      extractedClaims: claims.map((item) => `[${item.type}] ${item.title}`),
      sourceUrl: source.url,
      sourceType: source.sourceType,
      transport: source.fromCache ? 'cache' : source.transport,
    };
  });
}

export function toBlastRadiusAnalysis(analysis: ManifestResearchResult): FullBlastRadiusAnalysis {
  const reports: DependencyRiskReport[] = [];
  const trace: string[] = [];

  let totalBreakingChanges = 0;
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let unlockedSources = 0;
  let totalSources = 0;
  let cacheHits = 0;

  for (const result of analysis.results) {
    const breaking = result.knowledge.filter(isBreaking);
    const breakingChanges = breaking.map((item) => toBreakingChange(item, result));

    for (const item of breakingChanges) {
      totalBreakingChanges++;
      if (item.severity === 'CRITICAL') criticalCount++;
      else if (item.severity === 'HIGH') highCount++;
      else if (item.severity === 'MEDIUM') mediumCount++;
      else lowCount++;
    }

    for (const source of result.trace.fetched) {
      totalSources++;
      if (source.fromCache) cacheHits++;
      else if (source.transport === 'brightdata') unlockedSources++;

      trace.push(
        `${result.package}: ${source.fromCache ? 'cache' : source.transport} · ${source.sourceType} · ${source.extracted} claim(s) · ${source.url}`,
      );
    }

    if (result.trace.servedFromIndex) {
      trace.push(`${result.package}: served from the knowledge index — no fetching required.`);
    }
    for (const failure of result.trace.failures) {
      trace.push(`${result.package}: fetch failed — ${failure.reason}`);
    }

    // The plan is ordered by authority, so the first source read is the most
    // authoritative one that actually resolved.
    const primarySource = result.trace.fetched[0];

    reports.push({
      dependency: toDependency(result),
      overallRiskScore: result.risk.score,
      riskLevel: result.risk.level,
      breakingChanges,
      sources: toResearchedSources(result),
      research: {
        sourcesFetched: result.trace.fetched.length,
        knowledgeExtracted: result.knowledge.length,
        servedFromIndex: result.trace.servedFromIndex,
        primaryUrl: primarySource?.url ?? result.metadata?.registryUrl ?? '',
        failures: result.trace.failures.length,
      },
    });
  }

  return {
    id: analysis.id,
    createdAt: analysis.createdAt,
    ecosystem: analysis.ecosystem,
    totalDependencies: analysis.results.length,
    totalBreakingChanges,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    overallSafetyRating: analysis.overallSafety,
    reports,
    researchSummary: {
      totalSourcesFetched: totalSources,
      unlockedSourceCount: unlockedSources,
      cacheHits,
      trace,
    },
  };
}
