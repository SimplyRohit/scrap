/**
 * Text normalization and tokenization.
 *
 * Split out from `hash.ts` because these are pure string functions while hashing
 * needs `node:crypto`. Ranking and deduplication run inside Convex queries and
 * mutations, which execute in the Convex runtime where Node built-ins are
 * unavailable — keeping the two apart is what lets them.
 */

/**
 * Lowercases, strips punctuation and collapses whitespace so that
 * "foo() was removed", "foo() has been removed." and "Foo()  was removed"
 * normalize to the same string (gen.md section 12).
 */
export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~#>|]/g, '')
    .replace(/[^\w\s.()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word set with stopwords and boilerplate migration verbs removed. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had',
  'in', 'on', 'of', 'to', 'for', 'with', 'and', 'or', 'no', 'not', 'now', 'longer',
  'you', 'your', 'it', 'this', 'that', 'will', 'must', 'should', 'can', 'if',
]);

/** Token list with duplicates preserved — BM25 needs term frequency. */
export function tokenize(text: string): string[] {
  return normalizeForHash(text)
    .split(/[\s.]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function contentTokens(text: string): Set<string> {
  return new Set(tokenize(text));
}

/** Jaccard similarity over content tokens — the cheap semantic-duplicate check. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection++;
  return intersection / (ta.size + tb.size - intersection);
}
