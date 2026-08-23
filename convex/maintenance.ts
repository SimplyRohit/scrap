/**
 * Scheduled housekeeping.
 *
 * Both jobs below exist because work can stop halfway: a cached body outlives
 * every TTL that would have used it, and an analysis whose worker died would
 * otherwise leave a client subscribed to something that will never move.
 */

import { v } from 'convex/values';

import { internalMutation } from './_generated/server';
import { MAX_PACKAGES_PER_ANALYSIS } from './model/analyses';

/** How long an analysis may sit unfinished before it is declared dead. */
const STALL_MS = 60 * 60_000;

/** Analyses inspected per run. */
const REAP_LIMIT = 50;

export const reapStalledAnalyses = internalMutation({
  args: {},
  returns: v.object({ failed: v.number() }),
  handler: async (ctx) => {
    const cutoff = new Date(Date.now() - STALL_MS).toISOString();
    let failed = 0;

    for (const status of ['pending', 'running'] as const) {
      const candidates = await ctx.db
        .query('analyses')
        .withIndex('by_status', (q) => q.eq('status', status))
        .take(REAP_LIMIT);

      for (const analysis of candidates) {
        if (analysis.createdAt >= cutoff) continue;

        const packages = await ctx.db
          .query('analysisPackages')
          .withIndex('by_analysis', (q) => q.eq('analysisId', analysis._id))
          .take(MAX_PACKAGES_PER_ANALYSIS);

        // Whatever finished still counts; only the rows still in flight are lost.
        for (const row of packages) {
          if (row.status === 'done' || row.status === 'failed') continue;
          await ctx.db.patch(row._id, { status: 'failed', error: 'Research stalled and was reaped.' });
        }

        await ctx.db.patch(analysis._id, {
          status: 'failed',
          error: 'Research stalled and was reaped.',
          finishedAt: new Date().toISOString(),
        });
        failed++;
      }
    }

    return { failed };
  },
});
