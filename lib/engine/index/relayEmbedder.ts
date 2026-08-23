/**
 * Embedder that spends the deployed site's Voyage key instead of a local one.
 *
 * Vectors are stored in the caller's index alongside the knowledge they belong
 * to, so a relayed embedding is a one-time cost per object — a backfill runs
 * against the relay once and every later query is scored locally.
 *
 * The `id` is deliberately not `voyage:<model>`. The store refuses to compare
 * vectors produced by different embedders, and that check is the only thing
 * standing between a relayed backfill and a local one silently mixing two
 * coordinate spaces into one similarity score.
 */

import { registerEmbedder, type Embedder, type EmbeddingKind } from './embeddings';
import { relayConfigured, relayPost, RELAY_TIMEOUT_MS } from '../relay';

/**
 * Inputs per request. Smaller than the Voyage client's own batch because this
 * one crosses two hops: a batch that times out at the relay has to be redone in
 * full, and the relay is a shared resource with a per-caller budget.
 */
const BATCH_SIZE = 48;

/** Matches the width the relay's model produces; a mismatch is rejected below. */
const DIMENSIONS = 1024;

interface RelayEmbedResponse {
  embeddings?: number[][];
  model?: string;
}

export class RelayEmbedder implements Embedder {
  readonly id = 'relay:voyage';
  readonly dimensions = DIMENSIONS;

  async embed(texts: string[], kind: EmbeddingKind = 'document'): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      const body = await relayPost<RelayEmbedResponse>(
        '/api/relay/embed',
        { inputs: batch, kind },
        RELAY_TIMEOUT_MS,
      );

      const embeddings = body.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        throw new Error(`Relay returned ${embeddings.length} embeddings for ${batch.length} inputs`);
      }
      for (const vector of embeddings) {
        if (!Array.isArray(vector) || vector.length !== DIMENSIONS) {
          throw new Error(`Relay returned a ${vector?.length ?? 0}-dimension vector, expected ${DIMENSIONS}`);
        }
      }

      vectors.push(...embeddings);
    }

    return vectors;
  }
}

/**
 * Registers the relay embedder when there is a relay and no local Voyage key.
 * Returns whether semantic retrieval is now available.
 */
export function configureEmbeddingsFromRelay(): boolean {
  if (!relayConfigured()) return false;
  registerEmbedder(new RelayEmbedder());
  return true;
}
