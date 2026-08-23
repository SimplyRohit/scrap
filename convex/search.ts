'use node';

/**
 * Retrieval over the knowledge index.
 *
 * Its own file, and a Node one, for a reason that is easy to lose: Convex
 * reaches the vector index from **actions only**. This lived in `knowledge.ts`
 * as a query, which meant `selectCandidates` could read the text index and
 * nothing else — every hosted search came back with `semantic: 0` against an
 * index where every row already carried an embedding. The retrieval half of the
 * product was absent, and nothing failed to say so.
 *
 * `knowledge.ts` cannot host this: it holds queries and mutations, so it runs in
 * the Convex runtime, and the engine it would have to import reaches for
 * `node:fs`. The CLI and the MCP server were never affected — both embed the
 * query in their own process and call the same `store.search` this calls.
 */

import { ConvexError, v } from 'convex/values';

import { action } from './_generated/server';
import { withEngine } from './model/engine';
import { scoredKnowledge, searchQuery } from './validators';
import { categorize, confidenceCaveat } from '../lib/engine/analysis/confidence';
import { embedQuery } from '../lib/engine/index/embeddings';
import type { ScoredKnowledge } from '../lib/engine/index/ranking';

const searchResponse = v.object({
  results: v.array(scoredKnowledge),
  confidence: v.number(),
  confidenceCategory: v.string(),
  caveat: v.union(v.null(), v.string()),
  recommendedAction: v.array(v.string()),
  sources: v.array(v.string()),
});

/**
 * The shaping the API does on top of the ranker: a confidence category, the
 * caveat that stops a low-confidence hit being read as fact, and what to do when
 * the index simply has nothing.
 */
function withConfidence(results: ScoredKnowledge[]) {
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
}

/** Hybrid retrieval — lexical candidates and vector neighbours, ranked together. */
export const withConfidenceScores = action({
  args: searchQuery,
  returns: searchResponse,
  handler: async (ctx, args): Promise<ReturnType<typeof withConfidence>> => {
    if (!args.text?.trim() && !args.package) {
      throw new ConvexError('Provide `text` or `package` — search will not scan the whole index.');
    }

    return withEngine(ctx, async (store) => {
      // Embedded inside `withEngine`, because that is what registers the
      // embedder from `VOYAGE_API_KEY`. Outside it this returns null on a
      // deployment perfectly capable of semantic retrieval.
      const embedding = args.text?.trim() ? await embedQuery(args.text) : null;

      return withConfidence(await store.search({ ...args, embedding }));
    });
  },
});
