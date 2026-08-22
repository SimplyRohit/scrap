/**
 * Embedding seam (gen.md section 11, Phase 2).
 *
 * Retrieval is hybrid: a lexical score from BM25 and a semantic score from a
 * vector. The lexical half always works; the semantic half exists only when an
 * embedder has been registered. Nothing here knows which provider that is —
 * `voyage.ts` supplies one, tests supply a deterministic fake, and with neither
 * registered the store falls back to lexical without a code path changing.
 */

/**
 * Asymmetric retrieval: a stored claim and the question asked of it are not the
 * same kind of text, and providers encode them differently. Providers that make
 * no such distinction can ignore this.
 */
export type EmbeddingKind = 'document' | 'query';

export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[], kind?: EmbeddingKind): Promise<number[][]>;
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

/**
 * Embeds a batch. Returns null when no embedder is registered — the caller is
 * expected to carry on without vectors. Provider failures throw, because a
 * backfill that silently embedded nothing would look like a successful one.
 */
export async function embedAll(texts: string[], kind: EmbeddingKind = 'document'): Promise<number[][] | null> {
  if (!active || texts.length === 0) return null;
  return active.embed(texts, kind);
}

/**
 * Embeds a search query. Unlike `embedAll` this swallows provider failures: a
 * degraded lexical answer is worth more than a failed search.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (!active || !text.trim()) return null;
  try {
    const [vector] = await active.embed([text], 'query');
    return vector ?? null;
  } catch {
    return null;
  }
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
