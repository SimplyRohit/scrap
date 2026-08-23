/**
 * The knowledge index API (gen.md sections 11, 26).
 *
 * Reads are public: retrieval is the point of the system, and search never
 * scrapes — it answers from what is indexed and reports how confident that
 * answer is. Writes are internal, because the only legitimate way into the index
 * is through research or verified feedback, both of which are actions.
 */

import { ConvexError, v } from 'convex/values';

import { internalMutation, internalQuery, query } from './_generated/server';
import * as Knowledge from './model/knowledge';
import { categorize, confidenceCaveat } from '../lib/engine/analysis/confidence';
import { brightDataConfigured, githubConfigured, serpConfigured } from '../lib/engine/capabilities';
import { knowledgeObject, knowledgePatch, scoredKnowledge, searchQuery } from './validators';

export const search = query({
  args: searchQuery,
  returns: v.array(scoredKnowledge),
  handler: async (ctx, args) => {
    if (!args.text?.trim() && !args.package) {
      throw new ConvexError('Provide `text` or `package` — search will not scan the whole index.');
    }
    return Knowledge.searchKnowledge(ctx, args);
  },
});

/**
 * Search with the caveat attached.
 *
 * The extra shaping the old `POST /api/search` did — confidence category, the
 * caveat that stops a low-confidence hit being read as fact, and what to do when
 * nothing is indexed — belongs to the API rather than to the ranker.
 */
export const searchWithConfidence = query({
  args: searchQuery,
  returns: v.object({
    results: v.array(scoredKnowledge),
    confidence: v.number(),
    confidenceCategory: v.string(),
    caveat: v.union(v.null(), v.string()),
    recommendedAction: v.array(v.string()),
    sources: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!args.text?.trim() && !args.package) {
      throw new ConvexError('Provide `text` or `package` — search will not scan the whole index.');
    }

    const results = await Knowledge.searchKnowledge(ctx, args);
    const confidence = results[0]?.knowledge.confidence ?? 0;

    return {
      results,
      confidence,
      confidenceCategory: categorize(confidence),
      caveat: confidenceCaveat(confidence),
      recommendedAction:
        results.length === 0 ? ['Run research.packageUpgrade to index this package first'] : [],
      sources: results.flatMap(({ knowledge }) => knowledge.sources.map((source) => source.url)),
    };
  },
});

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), knowledgeObject),
  handler: async (ctx, args) => Knowledge.getKnowledge(ctx, args.id),
});

export const byIds = query({
  args: { ids: v.array(v.string()) },
  returns: v.array(knowledgeObject),
  handler: async (ctx, args) => Knowledge.getManyKnowledge(ctx, args.ids),
});

/** Index statistics and what the deployment is actually configured to do. */
export const stats = query({
  args: {},
  returns: v.object({
    total: v.number(),
    packages: v.number(),
    byType: v.record(v.string(), v.number()),
    byPackage: v.record(v.string(), v.number()),
    withEmbeddings: v.number(),
    embeddingModels: v.array(v.string()),
    lastUpdated: v.union(v.null(), v.string()),
    capabilities: v.object({
      brightData: v.boolean(),
      brightDataSerp: v.boolean(),
      github: v.boolean(),
      embeddings: v.boolean(),
      voyage: v.boolean(),
    }),
  }),
  handler: async (ctx) => {
    const stats = await Knowledge.indexStats(ctx);

    return {
      ...stats,
      capabilities: {
        brightData: brightDataConfigured(),
        brightDataSerp: serpConfigured(),
        github: githubConfigured(),
        // Reported from the data rather than from a flag: an embedder that has
        // never written a vector is not a capability this deployment has.
        embeddings: stats.withEmbeddings > 0,
        voyage: Boolean(process.env.VOYAGE_API_KEY),
      },
    };
  },
});

export const findByFingerprint = internalQuery({
  args: { package: v.string(), fingerprint: v.string() },
  returns: v.union(v.null(), knowledgeObject),
  handler: async (ctx, args) => Knowledge.findByFingerprint(ctx, args.package, args.fingerprint),
});

export const hasCoverage = internalQuery({
  args: { package: v.string(), version: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) => Knowledge.hasCoverage(ctx, args.package, args.version),
});

export const upsertMany = internalMutation({
  args: { objects: v.array(knowledgeObject) },
  returns: v.object({ inserted: v.number(), updated: v.number(), total: v.number() }),
  handler: async (ctx, args) => Knowledge.upsertKnowledge(ctx, args.objects),
});

export const patchOne = internalMutation({
  args: { id: v.string(), changes: knowledgePatch },
  returns: v.union(v.null(), knowledgeObject),
  handler: async (ctx, args) => Knowledge.patchKnowledge(ctx, args.id, args.changes),
});

export const page = internalQuery({
  args: { cursor: v.union(v.null(), v.string()), limit: v.number() },
  returns: v.object({
    knowledge: v.array(knowledgeObject),
    cursor: v.union(v.null(), v.string()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => Knowledge.pageOfKnowledge(ctx, args.cursor, args.limit),
});

/** The backfill's working set: vectors that are missing, or from the wrong model. */
export const needingEmbedding = internalQuery({
  args: { model: v.string(), limit: v.number() },
  returns: v.array(knowledgeObject),
  handler: async (ctx, args) => Knowledge.needingEmbedding(ctx, args.model, args.limit),
});

/** Hydrates the ids a vector search returned, in the order it returned them. */
export const byDocIds = internalQuery({
  args: { ids: v.array(v.id('knowledge')) },
  returns: v.array(knowledgeObject),
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return docs.filter((doc) => doc !== null).map(Knowledge.fromDoc);
  },
});

export const removeMany = internalMutation({
  args: { ids: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => Knowledge.removeKnowledge(ctx, args.ids),
});

export const reconcileEmbeddingCount = internalMutation({
  args: { model: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Knowledge.reconcileEmbeddingCount(ctx, args.model);
    return null;
  },
});
