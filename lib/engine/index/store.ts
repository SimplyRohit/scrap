/**
 * The `KnowledgeStore` seam and its filesystem implementation.
 *
 * Retrieval is hybrid by design (gen.md section 11) and lives in `ranking.ts`;
 * this module is about persistence. A single JSON file is the offline default —
 * inspectable, diffable, no service to stand up — while the deployed backend
 * implements the same interface over Convex (`convex/model/knowledgeStore.ts`).
 * Nothing above this interface knows which one it is talking to.
 */

import { readFile, writeFile, rename, stat } from 'node:fs/promises';

import type { KnowledgeObject } from '../knowledge';
import { ensureDataDirs, indexFile } from '../paths';
import { coversVersion, summarize, type IndexStats, type KnowledgeStore, type UpsertResult } from './contract';
import { applyPatch, knowledgeKey, mergeKnowledge } from './merge';
import { rankKnowledge, type ScoredKnowledge, type SearchQuery } from './ranking';

export type { RankingSignals, ScoredKnowledge, SearchQuery } from './ranking';
export type { IndexStats, KnowledgeStore, UpsertResult } from './contract';
export { coversVersion, summarize } from './contract';

interface IndexFile {
  version: 1;
  updatedAt: string | null;
  knowledge: KnowledgeObject[];
}

const EMPTY_INDEX: IndexFile = { version: 1, updatedAt: null, knowledge: [] };

export class JsonKnowledgeStore implements KnowledgeStore {
  private cache: IndexFile | null = null;
  /** Identifies the file revision `cache` was read from. Null means "never read". */
  private cacheStamp: string | null = null;
  /** Serializes read-modify-write cycles so concurrent requests cannot lose entries. */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string = indexFile()) {}

  /**
   * Cheap identity for the file on disk. One `stat` per operation buys the
   * cross-process correctness a `writeQueue` cannot: that queue only orders
   * writes inside *this* process.
   */
  private async stamp(): Promise<string | null> {
    try {
      const info = await stat(this.filePath);
      return `${info.mtimeMs}:${info.size}`;
    } catch {
      return null;
    }
  }

  /**
   * Re-reads whenever the file has moved on.
   *
   * Caching until process exit is fine for a CLI, which lives for a second. The
   * MCP server lives for hours, and it held whatever the index looked like when
   * it started: knowledge added by the CLI meanwhile was invisible to the agent,
   * and — far worse — its next write serialised that stale snapshot back over
   * the file, deleting everything written in between. Reproduced before fixing.
   */
  private async load(): Promise<IndexFile> {
    const stamp = await this.stamp();
    if (this.cache && stamp === this.cacheStamp) return this.cache;

    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as IndexFile;
    } catch {
      this.cache = { ...EMPTY_INDEX, knowledge: [] };
    }
    this.cacheStamp = stamp;
    return this.cache;
  }

  private async persist(index: IndexFile): Promise<void> {
    await ensureDataDirs();
    // Write-then-rename: a crash mid-write leaves the previous index intact.
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(index, null, 2), 'utf8');
    await rename(temporary, this.filePath);

    // Adopt what we just wrote, or the next `load` re-reads our own output.
    this.cache = index;
    this.cacheStamp = await this.stamp();
  }

  async upsert(objects: KnowledgeObject[]): Promise<UpsertResult> {
    const run = this.writeQueue.then(async () => {
      const index = await this.load();
      const byKey = new Map(index.knowledge.map((item) => [knowledgeKey(item), item]));

      let inserted = 0;
      let updated = 0;

      for (const object of objects) {
        const key = knowledgeKey(object);
        const existing = byKey.get(key);

        if (!existing) {
          byKey.set(key, object);
          inserted++;
          continue;
        }

        byKey.set(key, mergeKnowledge(existing, object));
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

  async findByFingerprint(packageName: string, fingerprint: string): Promise<KnowledgeObject | null> {
    const index = await this.load();
    return index.knowledge.find((item) => item.package === packageName && item.fingerprint === fingerprint) ?? null;
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

      const updated = applyPatch(index.knowledge[position], changes);

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

  async hasCoverage(
    packageName: string,
    version?: string,
    ecosystem?: KnowledgeObject['ecosystem'],
  ): Promise<boolean> {
    const index = await this.load();
    return index.knowledge.some((item) => coversVersion(item, packageName, version, ecosystem));
  }

  async search(query: SearchQuery): Promise<ScoredKnowledge[]> {
    const index = await this.load();
    return rankKnowledge(index.knowledge, query);
  }

  async stats(): Promise<IndexStats> {
    const index = await this.load();
    return summarize(index.knowledge, index.updatedAt);
  }
}

let sharedStore: KnowledgeStore | null = null;

/** Process-wide store. Callers with no store of their own should use this. */
export function getStore(): KnowledgeStore {
  sharedStore ??= new JsonKnowledgeStore();
  return sharedStore;
}

export function setStore(store: KnowledgeStore | null): void {
  sharedStore = store;
}
