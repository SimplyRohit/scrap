/**
 * Knowledge index: document mapping, writes, and candidate selection.
 *
 * Convex's guidance is that public functions stay thin and the logic they share
 * lives in `convex/model`. Everything here takes a `ctx` and is called from the
 * wrappers in `convex/knowledge.ts` — or, during research, from the
 * `KnowledgeStore` adapter that lets the engine write here unchanged.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

import { knowledgeText, type KnowledgeObject } from '../../lib/engine/knowledge';
import { applyPatch, mergeKnowledge } from '../../lib/engine/index/merge';
import { rankKnowledge, type ScoredKnowledge, type SearchQuery } from '../../lib/engine/index/ranking';
import { coversVersion, type IndexStats, type UpsertResult } from '../../lib/engine/index/contract';

/**
 * How many rows a search may consider.
 *
 * Ranking is a full BM25 pass over the candidates, so the ceiling is what keeps
 * a query bounded no matter how large the index grows. Selection is by index —
 * package equality, or the full-text index — so the cap trims the tail, not the
 * head.
 */
export const CANDIDATE_LIMIT = 256;

/** Bound on the coverage probe (gen.md section 23), which only needs one hit. */
const COVERAGE_PROBE_LIMIT = 200;

export function packageKeyOf(packageName: string): string {
  return packageName.toLowerCase();
}

/** Engine object -> stored document. Adds the denormalized index fields. */
export function toDoc(knowledge: KnowledgeObject) {
  const { embedding, embeddingModel, ...rest } = knowledge;

  return {
    ...rest,
    packageKey: packageKeyOf(knowledge.package),
    text: knowledgeText(knowledge),
    // A vector index cannot index null, so "no embedding" is an absent field.
    // The model name goes with it: recording which embedder produced a vector
    // that is not there would make a stale entry look current.
    ...(embedding ? { embedding, embeddingModel } : {}),
  };
}

/** Stored document -> engine object. The inverse of `toDoc`. */
export function fromDoc(doc: Doc<'knowledge'>): KnowledgeObject {
  const { _id, _creationTime, packageKey, text, embedding, ...rest } = doc;
  void _id;
  void _creationTime;
  void packageKey;
  void text;

  return { ...rest, embedding: embedding ?? null };
}

/**
 * One page of the index, for the callers that genuinely need all of it —
 * the graph projection and re-extraction.
 *
 * Paged rather than collected: a Convex query may read 16k documents and 8 MB,
 * and knowledge objects carry their quoted evidence, so the byte ceiling
 * arrives long before the document one.
 */
export async function pageOfKnowledge(
  ctx: QueryCtx,
  cursor: string | null,
  limit: number,
): Promise<{ knowledge: KnowledgeObject[]; cursor: string | null; done: boolean }> {
  const page = await ctx.db.query('knowledge').paginate({ cursor, numItems: limit });

  return {
    knowledge: page.page.map(fromDoc),
    cursor: page.continueCursor,
    done: page.isDone,
  };
}

/** Rows whose vector is missing, or was produced by a different model. */
export async function needingEmbedding(ctx: QueryCtx, model: string, limit: number): Promise<KnowledgeObject[]> {
  const missing = await ctx.db
    .query('knowledge')
    .withIndex('by_embedding_model', (q) => q.eq('embeddingModel', undefined))
    .take(limit);

  if (missing.length >= limit) return missing.map(fromDoc);

  // Whatever budget is left goes to vectors from a model we can no longer
  // compare against, which are as unusable as no vector at all.
  const stale = await ctx.db
    .query('knowledge')
    .withIndex('by_embedding_model')
    .filter((q) => q.neq(q.field('embeddingModel'), model))
    .take(limit - missing.length);

  return [...missing, ...stale.filter((doc) => doc.embeddingModel !== undefined)].map(fromDoc);
}

export async function removeKnowledge(ctx: MutationCtx, ids: string[]): Promise<number> {
  let deleted = 0;
  let embeddingsRemoved = 0;

  for (const id of ids) {
    const doc = await docByKnowledgeId(ctx, id);
    if (!doc) continue;
    if (doc.embedding) embeddingsRemoved++;
    await ctx.db.delete(doc._id);
    deleted++;
  }

  if (deleted > 0) {
    const meta = await ctx.db.query('indexMeta').first();
    if (meta) {
      await ctx.db.patch(meta._id, {
        total: Math.max(0, meta.total - deleted),
        withEmbeddings: Math.max(0, meta.withEmbeddings - embeddingsRemoved),
      });
    }
  }

  return deleted;
}

/** Everything indexed for one package, bounded. Used by the graph projection. */
export async function forPackage(ctx: QueryCtx, packageName: string, limit: number): Promise<KnowledgeObject[]> {
  const docs = await ctx.db
    .query('knowledge')
    .withIndex('by_package', (q) => q.eq('packageKey', packageKeyOf(packageName)))
    .take(limit);

  return docs.map(fromDoc);
}

export async function docByKnowledgeId(ctx: QueryCtx, id: string): Promise<Doc<'knowledge'> | null> {
  return ctx.db
    .query('knowledge')
    .withIndex('by_knowledge_id', (q) => q.eq('id', id))
    .unique();
}

export async function getKnowledge(ctx: QueryCtx, id: string): Promise<KnowledgeObject | null> {
  const doc = await docByKnowledgeId(ctx, id);
  return doc ? fromDoc(doc) : null;
}

export async function getManyKnowledge(ctx: QueryCtx, ids: string[]): Promise<KnowledgeObject[]> {
  const unique = [...new Set(ids)];
  const docs = await Promise.all(unique.map((id) => docByKnowledgeId(ctx, id)));
  return docs.filter((doc): doc is Doc<'knowledge'> => doc !== null).map(fromDoc);
}

export async function findByFingerprint(
  ctx: QueryCtx,
  packageName: string,
  fingerprint: string,
): Promise<KnowledgeObject | null> {
  const doc = await ctx.db
    .query('knowledge')
    .withIndex('by_package_fingerprint', (q) =>
      q.eq('packageKey', packageKeyOf(packageName)).eq('fingerprint', fingerprint),
    )
    .first();

  return doc ? fromDoc(doc) : null;
}

/**
 * Selects the rows a query could plausibly match, then ranks them.
 *
 * Selection is deliberately index-only. A package-scoped search reads that
 * package's rows; a free-text search goes through the full-text index, which
 * does the recall work Convex is better at than we are. Precision — version
 * filtering, authority, confidence — is then applied by the shared ranker, so
 * the deployed index and the filesystem index return the same order.
 */
export async function searchKnowledge(ctx: QueryCtx, query: SearchQuery): Promise<ScoredKnowledge[]> {
  const candidates = await selectCandidates(ctx, query);
  return rankKnowledge(candidates.map(fromDoc), query);
}

async function selectCandidates(ctx: QueryCtx, query: SearchQuery): Promise<Doc<'knowledge'>[]> {
  if (query.package) {
    return ctx.db
      .query('knowledge')
      .withIndex('by_package', (q) => q.eq('packageKey', packageKeyOf(query.package!)))
      .take(CANDIDATE_LIMIT);
  }

  const text = query.text?.trim();
  if (text) {
    // One `eq` per filter field is all a search index allows; a multi-type
    // filter is left to the ranker, which applies it anyway.
    const onlyType = query.types?.length === 1 ? query.types[0] : undefined;

    return ctx.db
      .query('knowledge')
      .withSearchIndex('search_text', (q) => {
        const search = q.search('text', text);
        if (query.ecosystem) return search.eq('ecosystem', query.ecosystem);
        if (onlyType) return search.eq('type', onlyType);
        return search;
      })
      .take(CANDIDATE_LIMIT);
  }

  return [];
}

/** True when this package/version pair already has indexed knowledge. */
export async function hasCoverage(ctx: QueryCtx, packageName: string, version?: string): Promise<boolean> {
  const docs = await ctx.db
    .query('knowledge')
    .withIndex('by_package', (q) => q.eq('packageKey', packageKeyOf(packageName)))
    .take(COVERAGE_PROBE_LIMIT);

  return docs.some((doc) => coversVersion(fromDoc(doc), packageName, version));
}

/**
 * Inserts or merges a batch.
 *
 * The merge rules are the engine's (`index/merge.ts`), not this file's, so the
 * hosted index and the filesystem index accumulate evidence identically.
 */
export async function upsertKnowledge(ctx: MutationCtx, objects: KnowledgeObject[]): Promise<UpsertResult> {
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let embeddingsAdded = 0;

  const perPackage = new Map<string, { package: string; ecosystem: KnowledgeObject['ecosystem']; delta: number }>();
  const perType = new Map<KnowledgeObject['type'], number>();
  const models = new Set<string>();

  for (const object of objects) {
    const existing = await ctx.db
      .query('knowledge')
      .withIndex('by_package_fingerprint', (q) =>
        q.eq('packageKey', packageKeyOf(object.package)).eq('fingerprint', object.fingerprint),
      )
      .first();

    if (!existing) {
      await ctx.db.insert('knowledge', toDoc(object));
      inserted++;
      if (object.embedding) {
        embeddingsAdded++;
        if (object.embeddingModel) models.add(object.embeddingModel);
      }

      const key = packageKeyOf(object.package);
      const entry = perPackage.get(key) ?? { package: object.package, ecosystem: object.ecosystem, delta: 0 };
      entry.delta++;
      perPackage.set(key, entry);
      perType.set(object.type, (perType.get(object.type) ?? 0) + 1);
      continue;
    }

    const merged = mergeKnowledge(fromDoc(existing), object, now);
    await ctx.db.replace(existing._id, toDoc(merged));
    updated++;
    if (!existing.embedding && merged.embedding) embeddingsAdded++;
    if (merged.embeddingModel) models.add(merged.embeddingModel);
  }

  await recordWrite(ctx, { inserted, embeddingsAdded, models, perPackage, perType, now });

  const meta = await ctx.db.query('indexMeta').first();
  return { inserted, updated, total: meta?.total ?? inserted };
}

/**
 * Applies a partial update to one entry.
 *
 * Distinct from upsert because feedback must be able to *lower* confidence when
 * a fix is refuted, which the merge rules deliberately cannot do.
 */
export async function patchKnowledge(
  ctx: MutationCtx,
  id: string,
  changes: Partial<KnowledgeObject>,
): Promise<KnowledgeObject | null> {
  const doc = await docByKnowledgeId(ctx, id);
  if (!doc) return null;

  const updated = applyPatch(fromDoc(doc), changes);
  await ctx.db.replace(doc._id, toDoc(updated));

  // The backfill adds vectors through this path, not through upsert, so the
  // counters have to move here too — otherwise `stats` reports an index with no
  // embeddings while every row has one, and the capability report follows it.
  const gained = !doc.embedding && Boolean(updated.embedding);
  if (gained || (updated.embeddingModel && updated.embeddingModel !== doc.embeddingModel)) {
    await adjustEmbeddingCounters(ctx, gained ? 1 : 0, updated.embeddingModel, updated.updatedAt);
  }

  return updated;
}

/**
 * Repairs the embedding counters from a fact the backfill establishes.
 *
 * Maintained counters drift — this one did, across the change that introduced
 * it. But "the backfill found nothing left to embed" is an exact statement that
 * every row carries a current vector, so the pass that proves it is also the
 * cheapest place to write it down.
 */
export async function reconcileEmbeddingCount(ctx: MutationCtx, model: string): Promise<void> {
  const meta = await ctx.db.query('indexMeta').first();
  if (!meta) return;

  await ctx.db.patch(meta._id, {
    withEmbeddings: meta.total,
    embeddingModels: meta.total > 0 ? [...new Set([...meta.embeddingModels, model])].sort() : [],
  });
}

async function adjustEmbeddingCounters(
  ctx: MutationCtx,
  delta: number,
  model: string | undefined,
  now: string,
): Promise<void> {
  const meta = await ctx.db.query('indexMeta').first();
  if (!meta) return;

  await ctx.db.patch(meta._id, {
    withEmbeddings: Math.max(0, meta.withEmbeddings + delta),
    embeddingModels: model
      ? [...new Set([...meta.embeddingModels, model])].sort()
      : meta.embeddingModels,
    lastUpdated: now,
  });
}

interface WriteRecord {
  inserted: number;
  embeddingsAdded: number;
  models: Set<string>;
  perPackage: Map<string, { package: string; ecosystem: KnowledgeObject['ecosystem']; delta: number }>;
  perType: Map<KnowledgeObject['type'], number>;
  now: string;
}

/** Moves the counters that `stats()` reads, in the same transaction as the write. */
async function recordWrite(ctx: MutationCtx, record: WriteRecord): Promise<void> {
  const meta = await ctx.db.query('indexMeta').first();
  const byType: Record<string, number> = { ...(meta?.byType ?? {}) };
  for (const [type, delta] of record.perType) byType[type] = (byType[type] ?? 0) + delta;

  const embeddingModels = [...new Set([...(meta?.embeddingModels ?? []), ...record.models])].sort();

  if (meta) {
    await ctx.db.patch(meta._id, {
      total: meta.total + record.inserted,
      withEmbeddings: meta.withEmbeddings + record.embeddingsAdded,
      byType,
      embeddingModels,
      lastUpdated: record.now,
    });
  } else {
    await ctx.db.insert('indexMeta', {
      total: record.inserted,
      withEmbeddings: record.embeddingsAdded,
      byType,
      embeddingModels,
      lastUpdated: record.now,
    });
  }

  for (const [key, entry] of record.perPackage) {
    const existing = await ctx.db
      .query('packageStats')
      .withIndex('by_package_key', (q) => q.eq('packageKey', key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { count: existing.count + entry.delta, lastUpdated: record.now });
    } else {
      await ctx.db.insert('packageStats', {
        packageKey: key,
        package: entry.package,
        ecosystem: entry.ecosystem,
        count: entry.delta,
        lastUpdated: record.now,
      });
    }
  }
}

/** How many packages `stats()` will name before it stops counting them out. */
const STATS_PACKAGE_LIMIT = 500;

export async function indexStats(ctx: QueryCtx): Promise<IndexStats> {
  const meta = await ctx.db.query('indexMeta').first();
  const packages = await ctx.db.query('packageStats').take(STATS_PACKAGE_LIMIT);

  const byPackage: Record<string, number> = {};
  for (const entry of packages) byPackage[entry.package] = entry.count;

  return {
    total: meta?.total ?? 0,
    packages: packages.length,
    byType: meta?.byType ?? {},
    byPackage,
    withEmbeddings: meta?.withEmbeddings ?? 0,
    embeddingModels: meta?.embeddingModels ?? [],
    lastUpdated: meta?.lastUpdated ?? null,
  };
}

export type KnowledgeId = Id<'knowledge'>;
