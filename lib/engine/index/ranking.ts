/**
 * Retrieval ranking (gen.md section 11).
 *
 * Pure scoring over a candidate set: BM25 over claim text, plus version,
 * package, authority, recency, and — when a query vector is supplied and the
 * stored one came from the same model — semantic similarity. No I/O and no Node
 * built-ins, because this runs in three places: the filesystem store, the CLI,
 * and Convex queries, which execute in the Convex runtime.
 *
 * Candidate *selection* belongs to the store; this module only decides order.
 */

import { contentTokens, tokenize } from '../text';
import {
  knowledgeText,
  sourcePriority,
  type Ecosystem,
  type KnowledgeObject,
  type KnowledgeType,
} from '../knowledge';
import { satisfies } from '../semver';
import { cosineSimilarity, getEmbedder } from './embeddings';

export interface SearchQuery {
  text?: string;
  package?: string;
  ecosystem?: Ecosystem;
  /** Restricts to knowledge whose affected range includes this version. */
  version?: string;
  types?: KnowledgeType[];
  minConfidence?: number;
  /** Exact error type token, e.g. `PrismaClientInitializationError`. */
  errorType?: string;
  limit?: number;
  /** Precomputed query embedding, when the caller has one. */
  embedding?: number[] | null;
}

export interface RankingSignals {
  lexical: number;
  semantic: number;
  exactErrorMatch: number;
  packageMatch: number;
  versionMatch: number;
  authority: number;
  recency: number;
  documentType: number;
}

export interface ScoredKnowledge {
  knowledge: KnowledgeObject;
  score: number;
  signals: RankingSignals;
}

export const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Filters, scores and orders candidates.
 *
 * `candidates` may be the whole index or an index-narrowed subset; the filters
 * are idempotent, so a store that already applied some of them by index loses
 * nothing by passing them again.
 */
export function rankKnowledge(candidates: KnowledgeObject[], query: SearchQuery): ScoredKnowledge[] {
  const eligible = candidates.filter((item) => passesFilters(item, query));
  if (eligible.length === 0) return [];

  const lexicalScores = bm25(eligible, query.text ?? '');
  const now = Date.now();
  const model = getEmbedder()?.id ?? null;
  const useSemantic = model !== null && Array.isArray(query.embedding);

  const scored = eligible.map((knowledge, position) => {
    const signals: RankingSignals = {
      lexical: lexicalScores[position],
      semantic: useSemantic && usableVector(knowledge, model)
        ? cosineSimilarity(query.embedding!, knowledge.embedding!)
        : 0,
      exactErrorMatch: query.errorType && mentionsErrorType(knowledge, query.errorType) ? 1 : 0,
      packageMatch: query.package && knowledge.package.toLowerCase() === query.package.toLowerCase() ? 1 : 0,
      versionMatch: query.version && matchesVersion(knowledge, query.version) ? 1 : 0,
      authority: 1 - sourcePriority(knowledge.sources[0]?.sourceType ?? 'web') / 10,
      recency: recencyScore(knowledge, now),
      documentType: documentTypeWeight(knowledge.type),
    };

    return { knowledge, score: combine(signals, knowledge.confidence), signals };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, query.limit ?? DEFAULT_SEARCH_LIMIT);
}

/**
 * A vector is only comparable to the query vector if the same model produced
 * both. Rather than scoring a stale one — which yields a confident-looking
 * number that means nothing — it is ignored, and the lexical signal carries the
 * result until a backfill re-embeds it.
 */
export function usableVector(knowledge: KnowledgeObject, model: string | null): boolean {
  if (!knowledge.embedding) return false;
  // Vectors written before the model was recorded are given the benefit of the
  // doubt; `cosineSimilarity` still returns 0 if the widths disagree.
  if (!knowledge.embeddingModel) return true;
  return knowledge.embeddingModel === model;
}

export function passesFilters(knowledge: KnowledgeObject, query: SearchQuery): boolean {
  if (query.package && knowledge.package.toLowerCase() !== query.package.toLowerCase()) return false;
  if (query.ecosystem && knowledge.ecosystem !== query.ecosystem) return false;
  if (query.types && !query.types.includes(knowledge.type)) return false;
  if (query.minConfidence !== undefined && knowledge.confidence < query.minConfidence) return false;
  // Version is a hard filter: unversioned knowledge stays eligible, but knowledge
  // scoped to a different version range is excluded outright.
  if (query.version && knowledge.affected && !matchesVersion(knowledge, query.version)) return false;
  return true;
}

export function matchesVersion(knowledge: KnowledgeObject, version: string): boolean {
  if (knowledge.affected) return satisfies(version, knowledge.affected);
  if (knowledge.introduced) return satisfies(version, `>=${knowledge.introduced}`);
  return true;
}

/**
 * Error class names that identify nothing. `Error: params should be awaited` has
 * type `Error`, and treating that as an exact match would award the bonus to every
 * document containing the word "error" — which is most of them.
 */
const GENERIC_ERROR_TYPE = /^(unknown)?(error|exception|fault|warning)$/i;

function mentionsErrorType(knowledge: KnowledgeObject, errorType: string): boolean {
  if (GENERIC_ERROR_TYPE.test(errorType)) return false;

  const needle = errorType.toLowerCase();
  return (
    knowledge.title.toLowerCase().includes(needle) ||
    knowledge.description.toLowerCase().includes(needle) ||
    knowledge.affectedApis.some((symbol) => symbol.toLowerCase().includes(needle))
  );
}

const RECENCY_HALF_LIFE_DAYS = 365;

function recencyScore(knowledge: KnowledgeObject, now: number): number {
  const published = knowledge.sources
    .map((source) => (source.publishedAt ? Date.parse(source.publishedAt) : NaN))
    .filter((value) => Number.isFinite(value));

  const timestamp = published.length > 0 ? Math.max(...published) : Date.parse(knowledge.updatedAt);
  if (!Number.isFinite(timestamp)) return 0.5;

  const ageDays = (now - timestamp) / 86_400_000;
  return Math.exp((-Math.LN2 * Math.max(0, ageDays)) / RECENCY_HALF_LIFE_DAYS);
}

const TYPE_WEIGHT: Partial<Record<KnowledgeType, number>> = {
  breaking_change: 1,
  removed_api: 1,
  renamed_api: 0.95,
  error_solution: 0.95,
  runtime_requirement: 0.9,
  dependency_requirement: 0.9,
  configuration_change: 0.85,
  deprecated_api: 0.8,
  environment_change: 0.8,
  behavior_change: 0.75,
  cli_change: 0.7,
  migration_example: 0.7,
  security_fix: 0.7,
  github_issue: 0.6,
  release_note: 0.5,
  new_api: 0.4,
  bug_fix: 0.4,
  performance_change: 0.3,
  github_commit: 0.3,
};

function documentTypeWeight(type: KnowledgeType): number {
  return TYPE_WEIGHT[type] ?? 0.5;
}

/**
 * Final ranking (gen.md section 11). Lexical and semantic dominate relevance;
 * the rest are corroboration signals. Confidence multiplies rather than adds, so
 * a well-matched but poorly evidenced claim cannot outrank a well-evidenced one.
 */
function combine(signals: RankingSignals, confidence: number): number {
  const relevance =
    signals.lexical * 0.34 +
    signals.semantic * 0.24 +
    signals.exactErrorMatch * 0.14 +
    signals.packageMatch * 0.08 +
    signals.versionMatch * 0.08 +
    signals.authority * 0.06 +
    signals.documentType * 0.04 +
    signals.recency * 0.02;

  return relevance * (0.55 + 0.45 * confidence);
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/** BM25 over the candidate set, normalized to 0..1 by the top score. */
function bm25(candidates: KnowledgeObject[], queryText: string): number[] {
  if (!queryText.trim()) return candidates.map(() => 0);

  const queryTokens = [...contentTokens(queryText)];
  if (queryTokens.length === 0) return candidates.map(() => 0);

  const documents = candidates.map((item) => {
    const tokens = tokenize(knowledgeText(item));
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return { length: tokens.length, frequencies };
  });

  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / documents.length || 1;

  const documentFrequency = new Map<string, number>();
  for (const token of queryTokens) {
    documentFrequency.set(token, documents.filter((document) => document.frequencies.has(token)).length);
  }

  const raw = documents.map((document) => {
    let score = 0;
    for (const token of queryTokens) {
      const frequency = document.frequencies.get(token);
      if (!frequency) continue;

      const df = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const denominator = frequency + BM25_K1 * (1 - BM25_B + (BM25_B * document.length) / averageLength);
      score += idf * ((frequency * (BM25_K1 + 1)) / denominator);
    }
    return score;
  });

  const max = Math.max(...raw, 0);
  return max === 0 ? raw.map(() => 0) : raw.map((score) => score / max);
}

