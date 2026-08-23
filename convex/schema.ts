/**
 * The database schema.
 *
 * Four concerns, kept apart:
 *
 *   knowledge      the structured index — the only durable product of research
 *   fetchCache     scraped bodies, so a URL is fetched once (gen.md section 22)
 *   analyses       one manifest run, and one row per package inside it
 *   stats          counters maintained on write, so reporting never scans
 *
 * Every equality lookup below has an index. Nothing in `convex/` calls
 * `.filter()` on a table scan, and nothing calls `.collect()` without a bound.
 */

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  analysisStatus,
  ecosystem,
  knowledgeDocument,
  packageLinks,
  packageRef,
  packageStatus,
  researchTrace,
  riskAssessment,
  safetyRating,
  transport,
  versionChange,
} from './validators';

/**
 * Embedding width, fixed at schema time by Convex.
 *
 * 1024 is what every current Voyage model emits, `voyage-3.5-lite` included —
 * see `MODEL_DIMENSIONS` in `lib/engine/index/voyage.ts`. Registering an
 * embedder of a different width means changing this and re-embedding, which is
 * why knowledge records `embeddingModel` alongside the vector: a mismatch is
 * detectable rather than silently scored.
 */
export const EMBEDDING_DIMENSIONS = 1024;

export default defineSchema({
  knowledge: defineTable(knowledgeDocument)
    // Identity, as the engine knows it (`k_<fingerprint>`).
    .index('by_knowledge_id', ['id'])
    // The dedupe key from gen.md section 12.
    .index('by_package_fingerprint', ['packageKey', 'fingerprint'])
    .index('by_package', ['packageKey'])
    .index('by_error_fingerprint', ['errorFingerprint'])
    // The backfill's working set: everything whose vector is missing or stale.
    .index('by_embedding_model', ['embeddingModel'])
    .searchIndex('search_text', {
      searchField: 'text',
      filterFields: ['packageKey', 'ecosystem', 'type'],
    })
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: EMBEDDING_DIMENSIONS,
      // `embeddingModel` is a filter field so a search can exclude vectors from
      // a model it cannot compare against, instead of scoring them anyway.
      filterFields: ['packageKey', 'ecosystem', 'embeddingModel'],
    }),

  /**
   * Cached documents. The body lives in file storage rather than in the row:
   * documentation pages routinely exceed Convex's 1 MiB document limit, and a
   * body is only ever read by an action that is about to normalize it.
   */
  fetchCache: defineTable({
    url: v.string(),
    urlHash: v.string(),
    status: v.number(),
    contentType: v.optional(v.string()),
    contentHash: v.string(),
    etag: v.optional(v.string()),
    lastModified: v.optional(v.string()),
    retrievedAt: v.string(),
    transport,
    body: v.id('_storage'),
    bytes: v.number(),
  })
    .index('by_url_hash', ['urlHash'])
    // ISO-8601 sorts chronologically, so the pruning cron can range-scan it.
    .index('by_retrieved_at', ['retrievedAt']),

  /** One manifest analysis. Packages inside it are researched as a fan-out. */
  analyses: defineTable({
    status: analysisStatus,
    ecosystem,
    fileName: v.string(),
    requested: v.number(),
    completed: v.number(),
    totalKnowledge: v.number(),
    overallSafety: v.optional(safetyRating),
    warnings: v.array(v.string()),
    error: v.optional(v.string()),
    refresh: v.optional(v.boolean()),
    maxDocuments: v.optional(v.number()),
    createdAt: v.string(),
    finishedAt: v.optional(v.string()),
  }).index('by_status', ['status']),

  analysisPackages: defineTable({
    analysisId: v.id('analyses'),
    /** Denormalized from `ref` so the row can be listed and indexed by name. */
    package: v.string(),
    ecosystem,
    status: packageStatus,
    /** Exactly what the worker needs to research this one package. */
    ref: packageRef,
    /** Everything below is filled in when the package finishes researching. */
    change: v.optional(versionChange),
    risk: v.optional(riskAssessment),
    metadata: v.optional(packageLinks),
    /** Engine ids, resolved against `knowledge.by_knowledge_id` when read back. */
    knowledgeIds: v.array(v.string()),
    trace: v.optional(researchTrace),
    warnings: v.array(v.string()),
    error: v.optional(v.string()),
  })
    .index('by_analysis', ['analysisId'])
    // Workers claim the next unstarted package through this index.
    .index('by_analysis_status', ['analysisId', 'status']),

  /**
   * Index counters.
   *
   * Maintained transactionally by the same mutations that write knowledge, so
   * `GET /api/index` is a couple of document reads instead of a full scan.
   */
  indexMeta: defineTable({
    total: v.number(),
    withEmbeddings: v.number(),
    // Keyed by `KnowledgeType`; the validator says `string` because Convex
    // records cannot have literal keys.
    byType: v.record(v.string(), v.number()),
    /** Distinct models behind those vectors. More than one means a backfill is due. */
    embeddingModels: v.array(v.string()),
    lastUpdated: v.string(),
  }),

  packageStats: defineTable({
    packageKey: v.string(),
    package: v.string(),
    ecosystem,
    count: v.number(),
    lastUpdated: v.string(),
  }).index('by_package_key', ['packageKey']),

  /**
   * Relay spend, counted per caller per window.
   *
   * The relay lends this deployment's Bright Data and Voyage keys to callers who
   * have none, so the ceiling on it is a ceiling on our bill. The Next.js
   * version of this counter lived in a module-level Map, which meant one bucket
   * per warm serverless instance and a real limit of "however many are running".
   * A table is the same code with one bucket, which is what a rate limit is for.
   */
  relayUsage: defineTable({
    caller: v.string(),
    endpoint: v.string(),
    count: v.number(),
    resetAt: v.number(),
  }).index('by_caller_endpoint', ['caller', 'endpoint']),
});
