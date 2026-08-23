/**
 * Embedding backfill (gen.md section 11, Phase 2).
 *
 * Research does not embed. It cannot: the pipeline has to work with no embedder
 * configured, and a free Voyage key allows three requests a minute — blocking a
 * user's analysis on that would trade a fast answer for a slightly better ranked
 * one. So vectors are added afterwards, by a scheduled pass that is resumable,
 * re-runnable, and a no-op once everything is current.
 *
 * This file stays in the Convex runtime rather than Node: the Voyage client is
 * `fetch` and nothing else, and the faster runtime is the right home for a job
 * that spends most of its life waiting on a rate limit.
 */

import { v } from 'convex/values';

import { internal } from './_generated/api';
import { action, internalAction } from './_generated/server';
import { embedAll, getEmbedder, needsEmbedding } from '../lib/engine/index/embeddings';
import { knowledgeText, type KnowledgeObject } from '../lib/engine/knowledge';
import { configureEmbeddingsFromEnv } from '../lib/engine/index/voyage';

/**
 * Objects embedded per invocation.
 *
 * Sized to the free tier: `VOYAGE_BATCH_TOKENS` caps one request at ~7K tokens
 * and `VOYAGE_RPM` paces them at three a minute, so a larger batch here would
 * spend the whole invocation waiting rather than doing more work.
 */
const BATCH = 32;

const result = v.object({
  model: v.union(v.null(), v.string()),
  embedded: v.number(),
  remaining: v.number(),
  failures: v.array(v.string()),
});

/**
 * Embeds one batch, then reschedules itself if there is more.
 *
 * Rescheduling rather than looping keeps each invocation inside its own time
 * budget, which matters here more than elsewhere: waiting out a rate limit is
 * the bulk of the work.
 */
export const backfill = internalAction({
  args: { limit: v.optional(v.number()) },
  returns: result,
  handler: async (ctx, args): Promise<{
    model: string | null;
    embedded: number;
    remaining: number;
    failures: string[];
  }> => {
    if (!getEmbedder() && !configureEmbeddingsFromEnv()) {
      return { model: null, embedded: 0, remaining: 0, failures: [] };
    }

    const embedder = getEmbedder()!;
    const limit = args.limit ?? BATCH;

    const pending: KnowledgeObject[] = await ctx.runQuery(internal.knowledge.needingEmbedding, {
      model: embedder.id,
      limit,
    });
    if (pending.length === 0) {
      // Nothing left to embed is an exact statement about the whole index, and
      // the cheapest opportunity to correct a counter that has drifted.
      await ctx.runMutation(internal.knowledge.reconcileEmbeddingCount, { model: embedder.id });
      return { model: embedder.id, embedded: 0, remaining: 0, failures: [] };
    }

    const stale = pending.filter((item) => needsEmbedding(item, embedder.id));
    const failures: string[] = [];
    let embedded = 0;

    try {
      const vectors = await embedAll(stale.map((item) => knowledgeText(item)));

      if (vectors) {
        for (const [position, vector] of vectors.entries()) {
          // A vector of the wrong width is a misconfiguration, not data: storing
          // it would put two coordinate spaces in one index.
          if (vector.length !== embedder.dimensions) {
            failures.push(`${stale[position].id}: expected ${embedder.dimensions} dimensions, got ${vector.length}`);
            continue;
          }

          await ctx.runMutation(internal.knowledge.patchOne, {
            id: stale[position].id,
            changes: { embedding: vector, embeddingModel: embedder.id },
          });
          embedded++;
        }
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    // Only continue when the batch was full and productive. A batch that failed
    // outright would otherwise reschedule itself forever against a dead key.
    if (embedded > 0 && pending.length >= limit) {
      await ctx.scheduler.runAfter(0, internal.embeddings.backfill, { limit });
    }

    return { model: embedder.id, embedded, remaining: pending.length - embedded, failures };
  },
});

/** Manual trigger, for `POST /api/index {"action":"backfill"}` and the CLI. */
export const runBackfill = action({
  args: { limit: v.optional(v.number()) },
  returns: result,
  handler: async (
    ctx,
    args,
  ): Promise<{ model: string | null; embedded: number; remaining: number; failures: string[] }> =>
    ctx.runAction(internal.embeddings.backfill, { limit: args.limit }),
});
