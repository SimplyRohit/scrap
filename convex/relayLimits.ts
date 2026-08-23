/**
 * The relay's spend guard, counted in the database.
 *
 * The Next.js version of this was a module-level `Map`, which on a serverless
 * host means one bucket per warm instance — a ceiling of "the limit times
 * however many are running", as its own comment admitted. One table row per
 * caller per endpoint is the same logic with one bucket, which is what a rate
 * limit is supposed to be.
 *
 * Still a courtesy rather than a security control: the caller key comes from
 * `x-forwarded-for`, which is trivially forged. It is worth having because the
 * traffic that actually drains a Bright Data balance is a loop that never
 * thought to forge a header.
 */

import { v } from 'convex/values';

import { internalMutation, type MutationCtx } from './_generated/server';
import { WINDOW_MS, relayLimit } from '../lib/engine/relayGuard';

/** Expired rows cleaned per call. Bounded so one request never pays for a backlog. */
const SWEEP = 20;

export const consume = internalMutation({
  args: { caller: v.string(), endpoint: v.string() },
  returns: v.object({ allowed: v.boolean(), retryAfterSeconds: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query('relayUsage')
      .withIndex('by_caller_endpoint', (q) => q.eq('caller', args.caller).eq('endpoint', args.endpoint))
      .unique();

    if (!existing || existing.resetAt <= now) {
      const row = { caller: args.caller, endpoint: args.endpoint, count: 1, resetAt: now + WINDOW_MS };
      if (existing) await ctx.db.replace(existing._id, row);
      else await ctx.db.insert('relayUsage', row);

      await sweep(ctx, now);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= relayLimit()) {
      return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
    }

    await ctx.db.patch(existing._id, { count: existing.count + 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  },
});

/**
 * Drops a few expired buckets on the way past.
 *
 * Cheaper than a cron for a table whose rows are only interesting for sixty
 * seconds, and it keeps the sweep proportional to the traffic that created the
 * rows in the first place.
 */
async function sweep(ctx: MutationCtx, now: number): Promise<void> {
  for (const row of await ctx.db.query('relayUsage').take(SWEEP)) {
    if (row.resetAt <= now) await ctx.db.delete(row._id);
  }
}
