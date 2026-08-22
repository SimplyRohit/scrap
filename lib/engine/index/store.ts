/**
 * The structured knowledge index (gen.md section 11).
 *
 * Hybrid retrieval: BM25 over claim text, plus metadata/package/version filters,
 * plus (when an embedder is registered) vector similarity. Version is a
 * first-class filter, not a ranking hint — "Prisma 5 error" must not match
 * "Prisma 7 error" (gen.md section 9).
 *
 * Persistence is a single JSON file behind the `KnowledgeStore` interface. That is
 * a Phase 1 choice, not an architectural one: swapping in Postgres + pgvector
 * means implementing this interface and nothing else.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';

import { contentTokens, tokenize } from '../hash';
import {
  knowledgeText,
  sourcePriority,
  type Ecosystem,
  type KnowledgeObject,
  type KnowledgeType,
} from '../knowledge';
import { satisfies } from '../semver';
import { INDEX_FILE, ensureDataDirs } from '../paths';
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

export interface UpsertResult {
  inserted: number;
  updated: number;
  total: number;
}

export interface IndexStats {
  total: number;
  packages: number;
  byType: Record<string, number>;
  byPackage: Record<string, number>;
  withEmbeddings: number;
  /** Distinct models behind those vectors. More than one means a backfill is due. */
  embeddingModels: string[];
  lastUpdated: string | null;
}

export interface KnowledgeStore {
  upsert(objects: KnowledgeObject[]): Promise<UpsertResult>;
  search(query: SearchQuery): Promise<ScoredKnowledge[]>;
  get(id: string): Promise<KnowledgeObject | null>;
  /**
   * Applies a partial update to one object.
   *
   * Separate from `upsert` because upsert only ever raises confidence — it assumes
   * new evidence corroborates. Feedback must also be able to *lower* confidence
   * when a fix is refuted, which upsert deliberately cannot do.
   */
  patch(id: string, changes: Partial<KnowledgeObject>): Promise<KnowledgeObject | null>;
  all(): Promise<KnowledgeObject[]>;
  /**
   * Deletes by id, returning how many existed. Separate from `patch` because
   * some knowledge should not be corrected but removed — an entry extracted
   * under rules that have since been tightened is not wrong about the world, it
   * should never have been indexed.
   */
  remove(ids: string[]): Promise<number>;
  stats(): Promise<IndexStats>;
  /** True when this package/version pair already has indexed knowledge (gen.md section 23). */
  hasCoverage(packageName: string, version?: string): Promise<boolean>;
}

interface IndexFile {
  version: 1;
  updatedAt: string | null;
  knowledge: KnowledgeObject[];
}

const EMPTY_INDEX: IndexFile = { version: 1, updatedAt: null, knowledge: [] };

export class JsonKnowledgeStore implements KnowledgeStore {
  private cache: IndexFile | null = null;
  /** Serializes read-modify-write cycles so concurrent requests cannot lose entries. */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string = INDEX_FILE) {}

  private async load(): Promise<IndexFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as IndexFile;
    } catch {
      this.cache = { ...EMPTY_INDEX, knowledge: [] };
    }
    return this.cache;
  }

  private async persist(index: IndexFile): Promise<void> {
    await ensureDataDirs();
    // Write-then-rename: a crash mid-write leaves the previous index intact.
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(index, null, 2), 'utf8');
    await rename(temporary, this.filePath);
  }

  async upsert(objects: KnowledgeObject[]): Promise<UpsertResult> {
    const run = this.writeQueue.then(async () => {
      const index = await this.load();
      const byKey = new Map(index.knowledge.map((item) => [`${item.package}:${item.fingerprint}`, item]));

      let inserted = 0;
      let updated = 0;

      for (const object of objects) {
        const key = `${object.package}:${object.fingerprint}`;
        const existing = byKey.get(key);

        if (!existing) {
          byKey.set(key, object);
          inserted++;
          continue;
        }

        // Merge sources rather than overwrite: re-research should accumulate
        // evidence, not discard what a previous run proved.
        const sources = [...existing.sources];
        for (const source of object.sources) {
          if (!sources.some((item) => item.url === source.url)) sources.push(source);
        }
        sources.sort((a, b) => sourcePriority(a.sourceType) - sourcePriority(b.sourceType));

        byKey.set(key, {
          ...existing,
          ...object,
          id: existing.id,
          createdAt: existing.createdAt,
          sources,
          confidence: Math.max(existing.confidence, object.confidence),
          // The vector and the model that produced it move together; taking one
          // from the incoming object and the other from the existing one would
          // mislabel it.
          ...(object.embedding
            ? { embedding: object.embedding, embeddingModel: object.embeddingModel }
            : { embedding: existing.embedding, embeddingModel: existing.embeddingModel }),
          updatedAt: new Date().toISOString(),
        });
        updated++;
      }

      const next: IndexFile = {
        version: 1,
        updatedAt: new Date().toISOString(),
        knowledge: [...byKey.values()],
      };
      this.cache = next;
      await this.persist(next);

      return { inserted, updated, total: next.knowledge.length };
    });

    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  async all(): Promise<KnowledgeObject[]> {
    return (await this.load()).knowledge;
  }

  async remove(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const run = this.writeQueue.then(async () => {
      const index = await this.load();
      const doomed = new Set(ids);
      const keep = index.knowledge.filter((item) => !doomed.has(item.id));
      const deleted = index.knowledge.length - keep.length;
      if (deleted === 0) return 0;

      const next: IndexFile = { version: 1, updatedAt: new Date().toISOString(), knowledge: keep };
      this.cache = next;
      await this.persist(next);
      return deleted;
    });

    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  async get(id: string): Promise<KnowledgeObject | null> {
    const index = await this.load();
    return index.knowledge.find((item) => item.id === id) ?? null;
  }

  async patch(id: string, changes: Partial<KnowledgeObject>): Promise<KnowledgeObject | null> {
    const run = this.writeQueue.then(async () => {
      const index = await this.load();
      const position = index.knowledge.findIndex((item) => item.id === id);
      if (position < 0) return null;

      const updated: KnowledgeObject = {
        ...index.knowledge[position],
        ...changes,
        // Identity is never patchable: changing either would orphan the entry
        // from its dedupe key or its references.
        id: index.knowledge[position].id,
        fingerprint: index.knowledge[position].fingerprint,
        updatedAt: new Date().toISOString(),
      };

      const next: IndexFile = {
        version: 1,
        updatedAt: new Date().toISOString(),
        knowledge: index.knowledge.map((item, at) => (at === position ? updated : item)),
      };
      this.cache = next;
      await this.persist(next);

      return updated;
    });

    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  async hasCoverage(packageName: string, version?: string): Promise<boolean> {
    const index = await this.load();
    return index.knowledge.some((item) => {
      if (item.package.toLowerCase() !== packageName.toLowerCase()) return false;
      if (!version) return true;
      return matchesVersion(item, version);
    });
  }

  async search(query: SearchQuery): Promise<ScoredKnowledge[]> {
    const index = await this.load();
    const candidates = index.knowledge.filter((item) => passesFilters(item, query));
    if (candidates.length === 0) return [];

    const lexicalScores = bm25(candidates, query.text ?? '');
    const now = Date.now();
    const model = getEmbedder()?.id ?? null;
    const useSemantic = model !== null && Array.isArray(query.embedding);

    const scored = candidates.map((knowledge, position) => {
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

    return scored.sort((a, b) => b.score - a.score).slice(0, query.limit ?? 20);
  }

  async stats(): Promise<IndexStats> {
    const index = await this.load();
    const byType: Record<string, number> = {};
    const byPackage: Record<string, number> = {};

    for (const item of index.knowledge) {
      byType[item.type] = (byType[item.type] ?? 0) + 1;
      byPackage[item.package] = (byPackage[item.package] ?? 0) + 1;
    }

    return {
      total: index.knowledge.length,
      packages: Object.keys(byPackage).length,
      byType,
      byPackage,
      withEmbeddings: index.knowledge.filter((item) => item.embedding !== null).length,
      embeddingModels: [
        ...new Set(index.knowledge.filter((item) => item.embedding).map((item) => item.embeddingModel ?? 'unknown')),
      ].sort(),
      lastUpdated: index.updatedAt,
    };
  }
}

/**
 * A vector is only comparable to the query vector if the same model produced
 * both. Rather than scoring a stale one — which yields a confident-looking
 * number that means nothing — it is ignored, and the lexical signal carries the
 * result until a backfill re-embeds it.
 */
function usableVector(knowledge: KnowledgeObject, model: string | null): boolean {
  if (!knowledge.embedding) return false;
  // Vectors written before the model was recorded are given the benefit of the
  // doubt; `cosineSimilarity` still returns 0 if the widths disagree.
  if (!knowledge.embeddingModel) return true;
  return knowledge.embeddingModel === model;
}

function passesFilters(knowledge: KnowledgeObject, query: SearchQuery): boolean {
  if (query.package && knowledge.package.toLowerCase() !== query.package.toLowerCase()) return false;
  if (query.ecosystem && knowledge.ecosystem !== query.ecosystem) return false;
  if (query.types && !query.types.includes(knowledge.type)) return false;
  if (query.minConfidence !== undefined && knowledge.confidence < query.minConfidence) return false;
  // Version is a hard filter: unversioned knowledge stays eligible, but knowledge
  // scoped to a different version range is excluded outright.
  if (query.version && knowledge.affected && !matchesVersion(knowledge, query.version)) return false;
  return true;
}

function matchesVersion(knowledge: KnowledgeObject, version: string): boolean {
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

let sharedStore: KnowledgeStore | null = null;

/** Process-wide store. Route handlers should use this rather than constructing their own. */
export function getStore(): KnowledgeStore {
  sharedStore ??= new JsonKnowledgeStore();
  return sharedStore;
}

export function setStore(store: KnowledgeStore | null): void {
  sharedStore = store;
}
