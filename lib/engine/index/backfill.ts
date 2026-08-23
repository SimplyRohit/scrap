/**
 * Embedding backfill (gen.md section 11, Phase 2).
 *
 * The index is written by the research pipelines, which do not embed: research
 * must work with no embedder configured. So vectors are added afterwards, in a
 * pass that can be re-run, resumed after a failure, and is a no-op once every
 * object is current.
 */

import { knowledgeText, type KnowledgeObject } from '../knowledge';
import { embedAll, getEmbedder } from './embeddings';
import { getStore, type KnowledgeStore } from './store';

export interface BackfillOptions {
  store?: KnowledgeStore;
  /** Ceiling on objects embedded in one call, to bound cost per invocation. */
  limit?: number;
  /**
   * Restricts the pass to these ids. Used right after indexing, so knowledge
   * researched in this run is searchable semantically within the same run
   * instead of only from the next one.
   */
  ids?: string[];
  /** Re-embeds everything, including objects that already carry a current vector. */
  refresh?: boolean;
}

export interface BackfillResult {
  /** Null when no embedder is registered — nothing was attempted. */
  model: string | null;
  /** Objects that needed a vector when the pass started. */
  pending: number;
  embedded: number;
  /** Objects left for a subsequent call because `limit` was reached. */
  remaining: number;
  failures: string[];
}

/** Objects per provider call. The provider batches internally too; this bounds
 * how much work is lost when one request fails. */
const CHUNK = 32;

/**
 * True when this object's vector is missing or was produced by a different
 * model. A vector from another model is worse than none: it scores.
 */
export function needsEmbedding(knowledge: KnowledgeObject, model: string): boolean {
  if (!knowledge.embedding) return true;
  return (knowledge.embeddingModel ?? '') !== model;
}

export async function backfillEmbeddings(options: BackfillOptions = {}): Promise<BackfillResult> {
  const embedder = getEmbedder();
  if (!embedder) {
    return { model: null, pending: 0, embedded: 0, remaining: 0, failures: [] };
  }

  const store = options.store ?? getStore();
  const stored = await store.all();
  const wanted = options.ids ? new Set(options.ids) : null;
  const all = wanted ? stored.filter((item) => wanted.has(item.id)) : stored;
  const pending = options.refresh ? all : all.filter((item) => needsEmbedding(item, embedder.id));

  const limit = options.limit ?? pending.length;
  const work = pending.slice(0, limit);

  const failures: string[] = [];
  let embedded = 0;

  for (let start = 0; start < work.length; start += CHUNK) {
    const chunk = work.slice(start, start + CHUNK);
    let vectors: number[][] | null;

    try {
      vectors = await embedAll(chunk.map(knowledgeText), 'document');
    } catch (error) {
      // One failed chunk must not abandon the vectors already written: record it
      // and let the next call pick the chunk up again.
      failures.push(error instanceof Error ? error.message : 'embedding request failed');
      continue;
    }

    if (!vectors) break;

    for (let index = 0; index < chunk.length; index++) {
      const vector = vectors[index];
      if (!vector) continue;
      await store.patch(chunk[index].id, { embedding: vector, embeddingModel: embedder.id });
      embedded++;
    }
  }

  return {
    model: embedder.id,
    pending: pending.length,
    embedded,
    remaining: pending.length - embedded,
    failures,
  };
}
