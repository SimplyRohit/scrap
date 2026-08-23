'use node';

/**
 * Binds the engine's pluggable backends to a Convex action.
 *
 * Three seams get filled here: the knowledge store, the fetch cache, and the
 * embedder. The store is also passed explicitly wherever the engine accepts one;
 * the other two are reached several layers down — the fetcher through the
 * registry and GitHub clients, the embedder through retrieval — so they are
 * installed as the process default for the duration of the call and cleared
 * afterwards.
 *
 * That is safe here specifically: these actions run in the Node runtime, where
 * one container serves one invocation at a time. Nothing below should be
 * imported into a query or mutation, which share an isolate.
 */

import type { ActionCtx } from '../_generated/server';

import type { KnowledgeStore } from '../../lib/engine/index/contract';
import { getEmbedder } from '../../lib/engine/index/embeddings';
import { setStore } from '../../lib/engine/index/store';
import { configureEmbeddingsFromEnv } from '../../lib/engine/index/voyage';
import { setCacheBackend } from '../../lib/engine/research/cache';
import { ConvexCacheBackend } from './fetchCache';
import { ConvexKnowledgeStore } from './knowledgeStore';

/**
 * Registers the Voyage embedder from `VOYAGE_API_KEY`, once per container.
 *
 * Explicit rather than on import, for the same reason the CLI's bootstrap is:
 * importing the engine must never acquire a network dependency and a paid key
 * because a variable happened to be set. Inside an action it is exactly what we
 * want — the deployment holds the key, so every caller gets semantic retrieval
 * without holding one themselves.
 */
export function semanticRetrievalAvailable(): boolean {
  if (getEmbedder()) return true;
  return configureEmbeddingsFromEnv();
}

export async function withEngine<T>(ctx: ActionCtx, run: (store: KnowledgeStore) => Promise<T>): Promise<T> {
  const store = new ConvexKnowledgeStore(ctx);

  setStore(store);
  setCacheBackend(new ConvexCacheBackend(ctx));
  semanticRetrievalAvailable();

  try {
    return await run(store);
  } finally {
    // Never leave a finished invocation's ctx reachable by the next one. The
    // embedder is stateless and keyed to deployment config, so it stays.
    setStore(null);
    setCacheBackend(null);
  }
}
