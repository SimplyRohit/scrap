/**
 * Manifest analyses (gen.md section 26: the blast-radius view).
 *
 * `start` returns an id immediately and schedules the work; the client
 * subscribes to `get` for progress and to `blastRadius` for the report, which
 * fills in package by package as research lands. Nothing here does I/O — the
 * research itself is an action in `research.ts`.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import * as Analyses from './model/analyses';
import * as Knowledge from './model/knowledge';
import { toBlastRadiusAnalysis } from '../lib/engine/adapters/legacy';
import { overallSafety } from '../lib/engine/analysis/versionDiff';
import type { KnowledgeObject } from '../lib/engine/knowledge';
import type { PackageResearchResult } from '../lib/engine/pipeline';
import {
  analysisStatus,
  blastRadiusAnalysis,
  ecosystem,
  packageLinks,
  packageRef,
  packageStatus,
  researchTrace,
  riskAssessment,
  safetyRating,
  versionChange,
} from './validators';

/** Packages researched at once. Registries and the unlocker are shared, rate-limited resources. */
const DEFAULT_CONCURRENCY = 3;

/** Knowledge objects loaded per package when rebuilding the report. */
const KNOWLEDGE_PER_PACKAGE = 50;

export const start = mutation({
  args: {
    ecosystem,
    fileName: v.string(),
    packages: v.array(packageRef),
    refresh: v.optional(v.boolean()),
    maxDocuments: v.optional(v.number()),
    warnings: v.optional(v.array(v.string())),
  },
  returns: v.id('analyses'),
  handler: async (ctx, args) => {
    if (args.packages.length === 0) throw new ConvexError('Nothing to analyse — `packages` is empty.');
    if (args.packages.length > Analyses.MAX_PACKAGES_PER_ANALYSIS) {
      throw new ConvexError(`Too many packages: ${args.packages.length} > ${Analyses.MAX_PACKAGES_PER_ANALYSIS}.`);
    }

    const analysisId = await ctx.db.insert('analyses', {
      status: 'pending',
      ecosystem: args.ecosystem,
      fileName: args.fileName,
      requested: args.packages.length,
      completed: 0,
      totalKnowledge: 0,
      warnings: args.warnings ?? [],
      refresh: args.refresh,
      maxDocuments: args.maxDocuments,
      createdAt: new Date().toISOString(),
    });

    for (const ref of args.packages) {
      await ctx.db.insert('analysisPackages', {
        analysisId,
        package: ref.name,
        ecosystem: ref.ecosystem,
        status: 'pending',
        ref,
        knowledgeIds: [],
        warnings: [],
      });
    }

    // Bounded fan-out: each worker researches one package and reschedules
    // itself, so a large manifest cannot exhaust a single action's time budget.
    const workers = Math.min(DEFAULT_CONCURRENCY, args.packages.length);
    for (let i = 0; i < workers; i++) {
      await ctx.scheduler.runAfter(0, internal.research.worker, { analysisId });
    }

    return analysisId;
  },
});

/** Progress, without the knowledge payload. Cheap enough to subscribe to. */
export const get = query({
  args: { analysisId: v.id('analyses') },
  returns: v.union(
    v.null(),
    v.object({
      status: analysisStatus,
      ecosystem,
      fileName: v.string(),
      requested: v.number(),
      completed: v.number(),
      totalKnowledge: v.number(),
      overallSafety: v.optional(safetyRating),
      warnings: v.array(v.string()),
      error: v.optional(v.string()),
      createdAt: v.string(),
      finishedAt: v.optional(v.string()),
      packages: v.array(
        v.object({
          package: v.string(),
          status: packageStatus,
          change: v.optional(versionChange),
          risk: v.optional(riskAssessment),
          knowledgeCount: v.number(),
          sourcesFetched: v.number(),
          servedFromIndex: v.boolean(),
          warnings: v.array(v.string()),
          error: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const analysis = await ctx.db.get(args.analysisId);
    if (!analysis) return null;

    const packages = await Analyses.packagesFor(ctx, args.analysisId);

    return {
      status: analysis.status,
      ecosystem: analysis.ecosystem,
      fileName: analysis.fileName,
      requested: analysis.requested,
      completed: analysis.completed,
      totalKnowledge: analysis.totalKnowledge,
      overallSafety: analysis.overallSafety,
      warnings: analysis.warnings,
      error: analysis.error,
      createdAt: analysis.createdAt,
      finishedAt: analysis.finishedAt,
      packages: packages.map((row) => ({
        package: row.package,
        status: row.status,
        change: row.change,
        risk: row.risk,
        knowledgeCount: row.knowledgeIds.length,
        sourcesFetched: row.trace?.fetched.length ?? 0,
        servedFromIndex: row.trace?.servedFromIndex ?? false,
        warnings: row.warnings,
        error: row.error,
      })),
    };
  },
});

/**
 * The full report.
 *
 * Built from whatever has finished, so the UI renders progressively rather than
 * waiting for the slowest package. The adapter is the same pure function the
 * HTTP API used — the view model has one producer, not two.
 */
export const blastRadius = query({
  args: { analysisId: v.id('analyses') },
  returns: v.union(v.null(), blastRadiusAnalysis),
  handler: async (ctx, args) => {
    const analysis = await ctx.db.get(args.analysisId);
    if (!analysis) return null;

    const rows = (await Analyses.packagesFor(ctx, args.analysisId)).filter((row) => row.status === 'done');

    const results: PackageResearchResult[] = [];
    for (const row of rows) {
      if (!row.change || !row.risk || !row.trace) continue;

      const knowledge: KnowledgeObject[] = await Knowledge.getManyKnowledge(
        ctx,
        row.knowledgeIds.slice(0, KNOWLEDGE_PER_PACKAGE),
      );

      results.push({
        package: row.package,
        ecosystem: row.ecosystem,
        change: row.change,
        metadata: Analyses.fromLinks(row.metadata),
        knowledge,
        risk: row.risk,
        trace: row.trace,
        warnings: row.warnings,
      });
    }

    return toBlastRadiusAnalysis({
      id: args.analysisId,
      createdAt: analysis.createdAt,
      ecosystem: analysis.ecosystem,
      fileName: analysis.fileName,
      results,
      // Derived from what has finished rather than read from the run, so a
      // half-researched manifest is never labelled safe to upgrade.
      overallSafety: analysis.overallSafety ?? overallSafety(results.map((item) => item.risk.level)),
      totalKnowledge: analysis.totalKnowledge,
      warnings: analysis.warnings,
    });
  },
});

/**
 * Hands a worker the next unstarted package.
 *
 * One transaction, so two workers cannot claim the same row.
 */
export const claimNext = internalMutation({
  args: { analysisId: v.id('analyses') },
  returns: v.union(
    v.null(),
    v.object({
      packageId: v.id('analysisPackages'),
      ref: packageRef,
      refresh: v.optional(v.boolean()),
      maxDocuments: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const analysis = await ctx.db.get(args.analysisId);
    if (!analysis) return null;

    const next = await ctx.db
      .query('analysisPackages')
      .withIndex('by_analysis_status', (q) => q.eq('analysisId', args.analysisId).eq('status', 'pending'))
      .first();

    if (!next) return null;

    await ctx.db.patch(next._id, { status: 'researching' });
    if (analysis.status === 'pending') await ctx.db.patch(args.analysisId, { status: 'running' });

    return {
      packageId: next._id,
      ref: next.ref,
      refresh: analysis.refresh,
      maxDocuments: analysis.maxDocuments,
    };
  },
});

export const completePackage = internalMutation({
  args: {
    packageId: v.id('analysisPackages'),
    change: versionChange,
    risk: riskAssessment,
    metadata: v.optional(packageLinks),
    knowledgeIds: v.array(v.string()),
    trace: researchTrace,
    warnings: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { packageId, ...result } = args;
    const row = await ctx.db.get(packageId);
    if (!row || row.status === 'done' || row.status === 'failed') return null;

    await ctx.db.patch(packageId, { ...result, status: 'done' });
    await Analyses.advance(ctx, row.analysisId);
    return null;
  },
});

/**
 * Records a package that could not be researched.
 *
 * A failure is a result: the analysis finishes, reports what it could not find
 * out, and never leaves the client subscribed to something that will not move.
 */
export const failPackage = internalMutation({
  args: { packageId: v.id('analysisPackages'), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.packageId);
    if (!row || row.status === 'done' || row.status === 'failed') return null;

    await ctx.db.patch(args.packageId, {
      status: 'failed',
      error: args.error,
      warnings: [...row.warnings, `${row.package}: research failed — ${args.error}`],
    });
    await Analyses.advance(ctx, row.analysisId);
    return null;
  },
});
