/**
 * The fetch cache table (gen.md section 22).
 *
 * Internal only: a cached page is an implementation detail of research, not
 * something a client should be able to read or poison. Bodies live in file
 * storage — documentation pages routinely exceed the 1 MiB document limit — so
 * every write here also owns the lifetime of a stored file.
 */

import { v } from 'convex/values';

import { internalMutation, internalQuery } from './_generated/server';
import { MAX_TTL_MS } from '../lib/engine/research/cachePolicy';
import { transport } from './validators';

/** Entries deleted per cron run — enough to keep up, small enough to stay one transaction. */
const DEFAULT_PRUNE_LIMIT = 200;

const entryFields = {
  url: v.string(),
  urlHash: v.string(),
  status: v.number(),
  contentType: v.optional(v.string()),
  contentHash: v.string(),
  etag: v.optional(v.string()),
  lastModified: v.optional(v.string()),
  retrievedAt: v.string(),
  transport,
};

const storedEntry = v.object({ ...entryFields, body: v.id('_storage'), bytes: v.number() });

export const lookup = internalQuery({
  args: { urlHash: v.string() },
  returns: v.union(v.null(), storedEntry),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query('fetchCache')
      .withIndex('by_url_hash', (q) => q.eq('urlHash', args.urlHash))
      .unique();

    if (!doc) return null;
    const { _id, _creationTime, ...entry } = doc;
    void _id;
    void _creationTime;
    return entry;
  },
});

/**
 * Records a fetched body, replacing whatever was cached for that URL.
 *
 * The previous file is deleted in the same transaction as the row that pointed
 * at it, so storage cannot accumulate copies nobody can reach.
 */
export const store = internalMutation({
  args: { ...entryFields, body: v.id('_storage'), bytes: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('fetchCache')
      .withIndex('by_url_hash', (q) => q.eq('urlHash', args.urlHash))
      .unique();

    if (existing) {
      await ctx.db.replace(existing._id, args);
      if (existing.body !== args.body) await ctx.storage.delete(existing.body);
      return null;
    }

    await ctx.db.insert('fetchCache', args);
    return null;
  },
});

/** A 304: the body is still current, only its age changed. */
export const touch = internalMutation({
  args: { urlHash: v.string(), retrievedAt: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('fetchCache')
      .withIndex('by_url_hash', (q) => q.eq('urlHash', args.urlHash))
      .unique();

    if (!existing) return false;
    await ctx.db.patch(existing._id, { retrievedAt: args.retrievedAt });
    return true;
  },
});

/**
 * Drops entries no source type would still call fresh.
 *
 * Bounded per run and driven by a cron: deleting a whole cache in one
 * transaction is exactly the kind of unbounded write Convex asks you not to do.
 */
export const prune = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const before = new Date(Date.now() - MAX_TTL_MS).toISOString();

    const stale = await ctx.db
      .query('fetchCache')
      .withIndex('by_retrieved_at', (q) => q.lt('retrievedAt', before))
      .take(args.limit ?? DEFAULT_PRUNE_LIMIT);

    for (const entry of stale) {
      await ctx.storage.delete(entry.body);
      await ctx.db.delete(entry._id);
    }

    return { deleted: stale.length };
  },
});
