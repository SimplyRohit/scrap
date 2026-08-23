/**
 * The engine's `KnowledgeStore`, backed by Convex.
 *
 * The pipeline was already written against this interface, so research runs
 * against the hosted index without a line of it changing: the same code that
 * writes a JSON file from the CLI writes documents here from an action.
 *
 * The one place this does more than translate is `search`. Convex's vector index
 * is reachable from actions only, so this is where retrieval becomes genuinely
 * hybrid — the lexical half comes back from a query, the semantic half from
 * `ctx.vectorSearch`, and the engine's own ranker orders the union.
 */

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { getEmbedder } from '../../lib/engine/index/embeddings';
import type { KnowledgeObject } from '../../lib/engine/knowledge';
import type { IndexStats, KnowledgeStore, UpsertResult } from '../../lib/engine/index/contract';
import { rankKnowledge, type ScoredKnowledge, type SearchQuery } from '../../lib/engine/index/ranking';

/** Nearest neighbours pulled per search. Convex allows up to 256. */
const VECTOR_CANDIDATES = 64;

/** Pages read by `all()`, and the ceiling on how many it will read. */
const PAGE_SIZE = 256;
const MAX_PAGES = 20;

export class ConvexKnowledgeStore implements KnowledgeStore {
  constructor(private readonly ctx: ActionCtx) {}

  async upsert(objects: KnowledgeObject[]): Promise<UpsertResult> {
    if (objects.length === 0) return { inserted: 0, updated: 0, total: 0 };
    return this.ctx.runMutation(internal.knowledge.upsertMany, { objects });
  }

  /**
   * Lexical candidates from the index, semantic candidates from the vector
   * index, ranked together.
   *
   * The union matters more than either half: a vector search alone loses exact
   * error-type matches, and BM25 alone loses an error phrased differently from
   * the changelog that documents it. Both are candidate *selection*; the score
   * that orders them is the engine's, so the hosted index and the filesystem
   * index rank identically given the same candidates.
   */
  async search(query: SearchQuery): Promise<ScoredKnowledge[]> {
    // Annotated rather than inferred: the generated `api` type is built from
    // this module's own imports, so leaving it to inference is circular.
    const lexical: ScoredKnowledge[] =
      query.text?.trim() || query.package ? await this.ctx.runQuery(api.knowledge.search, query) : [];

    const semantic = await this.semanticCandidates(query);
    if (semantic.length === 0) return lexical;

    const byId = new Map(lexical.map((result) => [result.knowledge.id, result.knowledge]));
    for (const knowledge of semantic) byId.set(knowledge.id, knowledge);

    return rankKnowledge([...byId.values()], query);
  }

  private async semanticCandidates(query: SearchQuery): Promise<KnowledgeObject[]> {
    const embedder = getEmbedder();
    if (!embedder || !Array.isArray(query.embedding) || query.embedding.length === 0) return [];

    const matches = await this.ctx.vectorSearch('knowledge', 'by_embedding', {
      vector: query.embedding,
      limit: Math.min(VECTOR_CANDIDATES, Math.max(query.limit ?? 0, VECTOR_CANDIDATES)),
      // Vectors from another model are not comparable to this query vector, so
      // they are excluded here rather than scored to zero later.
      filter: (q) =>
        query.package
          ? q.eq('packageKey', query.package.toLowerCase())
          : q.eq('embeddingModel', embedder.id),
    });

    if (matches.length === 0) return [];

    const hydrated: KnowledgeObject[] = await this.ctx.runQuery(internal.knowledge.byDocIds, {
      ids: matches.map((match) => match._id as Id<'knowledge'>),
    });

    return hydrated;
  }

  async get(id: string): Promise<KnowledgeObject | null> {
    return this.ctx.runQuery(api.knowledge.get, { id });
  }

  async patch(id: string, changes: Partial<KnowledgeObject>): Promise<KnowledgeObject | null> {
    // Identity is not patchable, and the mutation's validator says so by not
    // accepting these fields at all. Callers that hand over a whole knowledge
    // object — feedback does — would otherwise be rejected for the two fields
    // `applyPatch` was going to discard anyway.
    const { id: _id, fingerprint: _fingerprint, ...patchable } = changes;
    void _id;
    void _fingerprint;

    return this.ctx.runMutation(internal.knowledge.patchOne, { id, changes: patchable });
  }

  async findByFingerprint(packageName: string, fingerprint: string): Promise<KnowledgeObject | null> {
    return this.ctx.runQuery(internal.knowledge.findByFingerprint, { package: packageName, fingerprint });
  }

  /**
   * The whole index, in pages.
   *
   * Bounded on purpose: this exists for re-extraction and the graph projection,
   * both of which are batch jobs. Anything on a request path should be asking a
   * narrower question — `search`, `hasCoverage`, or `findByFingerprint`.
   */
  async all(): Promise<KnowledgeObject[]> {
    const knowledge: KnowledgeObject[] = [];
    let cursor: string | null = null;

    for (let read = 0; read < MAX_PAGES; read++) {
      const page: { knowledge: KnowledgeObject[]; cursor: string | null; done: boolean } =
        await this.ctx.runQuery(internal.knowledge.page, { cursor, limit: PAGE_SIZE });
      knowledge.push(...page.knowledge);
      if (page.done) break;
      cursor = page.cursor;
    }

    return knowledge;
  }

  async remove(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.ctx.runMutation(internal.knowledge.removeMany, { ids });
  }

  async stats(): Promise<IndexStats> {
    const { capabilities: _capabilities, ...stats } = await this.ctx.runQuery(api.knowledge.stats, {});
    void _capabilities;
    return stats;
  }

  async hasCoverage(
    packageName: string,
    version?: string,
    ecosystem?: KnowledgeObject['ecosystem'],
  ): Promise<boolean> {
    return this.ctx.runQuery(internal.knowledge.hasCoverage, { package: packageName, version, ecosystem });
  }
}
