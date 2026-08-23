/**
 * The persistence contract for indexed knowledge.
 *
 * Separate from `store.ts` because the implementation there is filesystem-backed
 * and the interface is not: Convex queries and mutations implement the same
 * contract, and they run where `node:fs` does not exist.
 */

import type { KnowledgeObject } from '../knowledge';
import { matchesVersion, type ScoredKnowledge, type SearchQuery } from './ranking';

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
  /**
   * Looks up one entry by its dedupe key.
   *
   * Exists so feedback can find the record it is about to reinforce without
   * reading the whole index — a scan is free against a JSON file and ruinous
   * against a database.
   */
  findByFingerprint(packageName: string, fingerprint: string): Promise<KnowledgeObject | null>;
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

/** Aggregates statistics over a full index. */
export function summarize(knowledge: KnowledgeObject[], lastUpdated: string | null): IndexStats {
  const byType: Record<string, number> = {};
  const byPackage: Record<string, number> = {};

  for (const item of knowledge) {
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    byPackage[item.package] = (byPackage[item.package] ?? 0) + 1;
  }

  return {
    total: knowledge.length,
    packages: Object.keys(byPackage).length,
    byType,
    byPackage,
    withEmbeddings: knowledge.filter((item) => item.embedding !== null).length,
    embeddingModels: [
      ...new Set(knowledge.filter((item) => item.embedding).map((item) => item.embeddingModel ?? 'unknown')),
    ].sort(),
    lastUpdated,
  };
}

/** Coverage test (gen.md section 23), shared so every store answers it identically. */
export function coversVersion(item: KnowledgeObject, packageName: string, version?: string): boolean {
  if (item.package.toLowerCase() !== packageName.toLowerCase()) return false;
  if (!version) return true;
  return matchesVersion(item, version);
}
