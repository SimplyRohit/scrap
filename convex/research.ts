'use node';

/**
 * Research (gen.md sections 22–26).
 *
 * Everything here reaches the network — registries, GitHub, documentation hosts,
 * Bright Data — and normalizes what comes back with `cheerio` and `node:crypto`,
 * so it runs in the Node runtime. The pipeline itself is unchanged from the
 * filesystem build: `withEngine` simply points its store and cache at Convex.
 */

import { v, type Infer } from 'convex/values';

import { internal } from './_generated/api';
import { action, internalAction } from './_generated/server';
import { toLinks } from './model/analyses';
import { withEngine } from './model/engine';
import { detectEcosystem } from '../lib/engine/ingestion/manifest';
import { renderBreakingChanges, renderMigrationPlan } from '../lib/engine/output/markdown';
import { researchPackageUpgrade, type PackageResearchResult } from '../lib/engine/pipeline';
import type { PackageRef } from '../lib/engine/request';
import {
  dependency,
  ecosystem,
  knowledgeObject,
  packageLinks,
  researchTrace,
  riskAssessment,
  versionChange,
} from './validators';

const scrapeEntry = v.object({
  change: versionChange,
  sources: researchTrace.fields.fetched,
  failures: researchTrace.fields.failures,
  knowledgeCount: v.number(),
  servedFromIndex: v.boolean(),
  warnings: v.array(v.string()),
});

const researchResult = v.object({
  package: v.string(),
  ecosystem,
  change: versionChange,
  metadata: v.union(v.null(), packageLinks),
  risk: riskAssessment,
  knowledge: v.array(knowledgeObject),
  trace: researchTrace,
  warnings: v.array(v.string()),
  documents: v.optional(v.record(v.string(), v.string())),
});

function refFor(input: {
  package: string;
  from: string;
  to?: string;
  ecosystem?: PackageRef['ecosystem'];
}): PackageRef {
  return {
    name: input.package,
    ecosystem: input.ecosystem ?? detectEcosystem(input.package, 'nodejs'),
    currentVersion: input.from,
    targetVersion: input.to,
    dependencyType: 'dependencies',
    specifier: input.from,
  };
}

function shape(result: PackageResearchResult, includeMarkdown?: boolean) {
  return {
    package: result.package,
    ecosystem: result.ecosystem,
    change: result.change,
    metadata: toLinks(result.metadata) ?? null,
    risk: result.risk,
    knowledge: result.knowledge,
    trace: result.trace,
    warnings: result.warnings,
    documents: includeMarkdown
      ? {
          'migration.md': renderMigrationPlan(result),
          'breaking-changes.md': renderBreakingChanges(result),
        }
      : undefined,
  };
}

/**
 * Researches one package upgrade end to end and indexes what it finds.
 *
 * This is both `POST /api/research` and `POST /api/index` from the old HTTP API:
 * indexing a package on demand *is* researching it, and pretending otherwise
 * meant two routes doing the same work.
 */
export const packageUpgrade = action({
  args: {
    package: v.string(),
    from: v.string(),
    to: v.optional(v.string()),
    ecosystem: v.optional(ecosystem),
    refresh: v.optional(v.boolean()),
    maxDocuments: v.optional(v.number()),
    includeMarkdown: v.optional(v.boolean()),
  },
  returns: researchResult,
  handler: async (ctx, args) => {
    const result = await withEngine(ctx, (store) =>
      researchPackageUpgrade(refFor(args), {
        store,
        refresh: args.refresh,
        maxDocuments: args.maxDocuments,
        targetVersion: args.to,
      }),
    );

    // Research never blocks on embedding — see `embeddings.ts` — but newly
    // indexed knowledge is invisible to semantic retrieval until it has a
    // vector, so the pass is queued the moment there is something to embed.
    if (result.knowledge.length > 0) {
      await ctx.scheduler.runAfter(0, internal.embeddings.backfill, {});
    }

    return shape(result, args.includeMarkdown);
  },
});

/**
 * Acquisition without analysis.
 *
 * "Scrape" is a misnomer for what happens now — sources are planned by
 * authority, served from cache when fresh, and normalized into knowledge — but
 * the shape is kept for callers that want the acquisition trace alone.
 */
export const scrape = action({
  args: {
    dependencies: v.array(dependency),
    refresh: v.optional(v.boolean()),
    maxDocuments: v.optional(v.number()),
  },
  returns: v.record(v.string(), scrapeEntry),
  handler: async (ctx, args) => {
    const scraped: Record<string, Infer<typeof scrapeEntry>> = {};

    await withEngine(ctx, async (store) => {
      for (const item of args.dependencies) {
        const result = await researchPackageUpgrade(
          {
            name: item.name,
            ecosystem: item.ecosystem,
            currentVersion: item.currentVersion,
            targetVersion: item.targetVersion || undefined,
            dependencyType: 'dependencies',
            specifier: item.currentVersion,
          },
          {
            store,
            refresh: args.refresh,
            maxDocuments: args.maxDocuments,
            targetVersion: item.targetVersion || undefined,
          },
        );

        scraped[item.name] = {
          change: result.change,
          sources: result.trace.fetched,
          failures: result.trace.failures,
          knowledgeCount: result.knowledge.length,
          servedFromIndex: result.trace.servedFromIndex,
          warnings: result.warnings,
        };
      }
    });

    return scraped;
  },
});

/**
 * One unit of a manifest analysis: claim a package, research it, record it,
 * then hand the queue back to a fresh invocation.
 *
 * Rescheduling rather than looping is deliberate. Each package gets a full
 * action time budget, a package that hangs cannot take the rest of the manifest
 * with it, and concurrency stays at however many workers `analyses.start`
 * launched.
 */
export const worker = internalAction({
  args: { analysisId: v.id('analyses') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(internal.analyses.claimNext, { analysisId: args.analysisId });
    if (!claim) return null;

    try {
      const result = await withEngine(ctx, (store) =>
        researchPackageUpgrade(claim.ref, {
          store,
          refresh: claim.refresh,
          maxDocuments: claim.maxDocuments,
          targetVersion: claim.ref.targetVersion,
        }),
      );

      if (result.knowledge.length > 0) {
        await ctx.scheduler.runAfter(0, internal.embeddings.backfill, {});
      }

      await ctx.runMutation(internal.analyses.completePackage, {
        packageId: claim.packageId,
        change: result.change,
        risk: result.risk,
        metadata: toLinks(result.metadata),
        knowledgeIds: result.knowledge.map((item) => item.id),
        trace: result.trace,
        warnings: result.warnings,
      });
    } catch (error) {
      await ctx.runMutation(internal.analyses.failPackage, {
        packageId: claim.packageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await ctx.scheduler.runAfter(0, internal.research.worker, { analysisId: args.analysisId });
    return null;
  },
});
