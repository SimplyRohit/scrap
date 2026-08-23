/**
 * Analysis-run bookkeeping.
 *
 * A manifest analysis is a queue, not a request: one row per package, claimed by
 * workers, each row finished independently. That is what lets the UI subscribe
 * to an analysis and watch it fill in, instead of holding a five-minute HTTP
 * connection open and hoping.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

import { overallSafety, type RiskLevel } from '../../lib/engine/analysis/versionDiff';
import type { PackageMetadata } from '../../lib/engine/research/registry';

/** Ceiling on packages read back for one analysis. A manifest larger than this is not a manifest. */
export const MAX_PACKAGES_PER_ANALYSIS = 500;

export async function packagesFor(ctx: QueryCtx, analysisId: Id<'analyses'>): Promise<Doc<'analysisPackages'>[]> {
  return ctx.db
    .query('analysisPackages')
    .withIndex('by_analysis', (q) => q.eq('analysisId', analysisId))
    .take(MAX_PACKAGES_PER_ANALYSIS);
}

/**
 * Marks one package finished and, if it was the last one, the analysis with it.
 *
 * Counting here rather than polling the rows means the completion check is part
 * of the same transaction that recorded the result, so two workers finishing at
 * once cannot both miss — or both fire — the finalization.
 */
export async function advance(ctx: MutationCtx, analysisId: Id<'analyses'>): Promise<void> {
  const analysis = await ctx.db.get(analysisId);
  if (!analysis) return;

  const completed = analysis.completed + 1;
  if (completed < analysis.requested) {
    await ctx.db.patch(analysisId, { completed, status: 'running' });
    return;
  }

  const packages = await packagesFor(ctx, analysisId);
  const levels = packages
    .map((row) => row.risk?.level)
    .filter((level): level is RiskLevel => level !== undefined);

  await ctx.db.patch(analysisId, {
    completed,
    status: 'complete',
    overallSafety: overallSafety(levels),
    totalKnowledge: packages.reduce((total, row) => total + row.knowledgeIds.length, 0),
    warnings: [...analysis.warnings, ...packages.flatMap((row) => row.warnings)],
    finishedAt: new Date().toISOString(),
  });
}

/**
 * Registry metadata worth storing.
 *
 * `versions` is dropped deliberately: it is every version ever published and
 * nothing that reads an analysis back needs it.
 */
export function toLinks(metadata: PackageMetadata | null) {
  if (!metadata) return undefined;

  return {
    name: metadata.name,
    ecosystem: metadata.ecosystem,
    latestVersion: metadata.latestVersion,
    registryUrl: metadata.registryUrl,
    repositoryUrl: metadata.repositoryUrl,
    githubSlug: metadata.githubSlug,
    homepage: metadata.homepage,
    documentationUrl: metadata.documentationUrl,
    changelogUrl: metadata.changelogUrl,
    description: metadata.description,
    deprecated: metadata.deprecated,
  };
}

/** Rebuilds the metadata the view-model adapter expects from what was stored. */
export function fromLinks(links: Doc<'analysisPackages'>['metadata']): PackageMetadata | null {
  if (!links) return null;
  return { ...links, versions: [] };
}
