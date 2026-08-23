/**
 * Upsert and patch semantics for indexed knowledge.
 *
 * Pure, and shared by every `KnowledgeStore` implementation so that the
 * filesystem index and the Convex index cannot drift apart on the rules that
 * matter: sources accumulate, confidence only rises on upsert, a vector travels
 * with the model that produced it, and identity is never rewritten.
 */

import { sourcePriority, type KnowledgeObject } from '../knowledge';

/** Dedupe key. Two claims about the same package with the same fingerprint are one claim. */
export function knowledgeKey(knowledge: Pick<KnowledgeObject, 'package' | 'fingerprint'>): string {
  return `${knowledge.package}:${knowledge.fingerprint}`;
}

/**
 * Folds new evidence into an existing entry.
 *
 * Re-research should accumulate evidence rather than discard what a previous run
 * proved, so sources are merged by URL and confidence takes the maximum. A
 * refutation must therefore go through `applyPatch`, which can move confidence
 * down.
 */
export function mergeKnowledge(
  existing: KnowledgeObject,
  incoming: KnowledgeObject,
  now = new Date().toISOString(),
): KnowledgeObject {
  const sources = [...existing.sources];
  for (const source of incoming.sources) {
    if (!sources.some((item) => item.url === source.url)) sources.push(source);
  }
  sources.sort((a, b) => sourcePriority(a.sourceType) - sourcePriority(b.sourceType));

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    createdAt: existing.createdAt,
    sources,
    confidence: Math.max(existing.confidence, incoming.confidence),
    // The vector and the model that produced it move together; taking one from
    // the incoming object and the other from the existing one would mislabel it.
    ...(incoming.embedding
      ? { embedding: incoming.embedding, embeddingModel: incoming.embeddingModel }
      : { embedding: existing.embedding, embeddingModel: existing.embeddingModel }),
    updatedAt: now,
  };
}

/**
 * Applies a partial update.
 *
 * Identity is never patchable: changing `id` or `fingerprint` would orphan the
 * entry from its dedupe key or from the references that cite it.
 */
export function applyPatch(
  existing: KnowledgeObject,
  changes: Partial<KnowledgeObject>,
  now = new Date().toISOString(),
): KnowledgeObject {
  return {
    ...existing,
    ...changes,
    id: existing.id,
    fingerprint: existing.fingerprint,
    updatedAt: now,
  };
}
