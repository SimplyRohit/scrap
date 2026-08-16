/**
 * Embedding seam (gen.md section 11, Phase 2).
 *
 * Retrieval is hybrid by design, but Phase 1 ships the lexical half only. This
 * module defines the contract so vectors can be added without touching the store,
 * the ranker, or the pipeline: register an embedder, backfill, and `search()`
 * starts blending a semantic score automatically.
 */

export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

let active: Embedder | null = null;

export function registerEmbedder(embedder: Embedder | null): void {
  active = embedder;
}

export function getEmbedder(): Embedder | null {
  return active;
}

export function embeddingsEnabled(): boolean {
  return active !== null;
}

export async function embedAll(texts: string[]): Promise<number[][] | null> {
  if (!active || texts.length === 0) return null;
  return active.embed(texts);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
