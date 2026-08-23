/**
 * Offline re-extraction (gen.md sections 6, 22).
 *
 * Extraction rules get tightened whenever a false positive is found, but the
 * index keeps whatever earlier runs wrote. `prune` can only drop entries by
 * their title; anything that needs *reclassifying* needs the original document,
 * because the type depends on the heading the claim sat under.
 *
 * The documents are still here. Every knowledge object records the URL it came
 * from, and the fetch cache holds the body. So the whole index can be rebuilt
 * under current rules with no network at all — which is the difference between
 * a five-second correction and re-scraping six packages.
 */

import { deduplicate } from '../analysis/dedupe';
import { extractKnowledge } from '../analysis/extract';
import { normalizeDocument } from '../analysis/normalize';
import type { KnowledgeObject, SourceRef } from '../knowledge';
import { readCache } from '../research/cache';
import { getStore, type KnowledgeStore } from './store';

/** High enough that a project's whole changelog replays; still bounded. */
const REPLAY_MAX_CLAIMS = 2_000;

export interface ReindexOptions {
  store?: KnowledgeStore;
  /** Limits the pass to one package. */
  package?: string;
  /** Reports what would change without writing anything. */
  dryRun?: boolean;
  /**
   * Also delete objects the new rules did not reproduce.
   *
   * Off by default, and deliberately so. Re-extraction is not guaranteed to be
   * a faithful replay: the claim budget, and the version context recorded on
   * the objects rather than on the original run, can both make a document yield
   * fewer claims this time. Deleting on that basis loses real knowledge to an
   * artefact. Adding and reclassifying are safe; removing is a choice.
   */
  pruneMissing?: boolean;
}

export interface ReindexResult {
  /** Documents whose body was found in the cache and re-extracted. */
  documents: number;
  /** Documents named by the index but no longer in the cache. */
  missing: number;
  /** Knowledge objects produced by the new rules. */
  extracted: number;
  /** Objects the new rules did not reproduce. Deleted only with `pruneMissing`. */
  removed: string[];
  /** True when `removed` was reported but not acted on. */
  removalsHeld: boolean;
  /** Objects whose classification changed, as `title: old -> new`. */
  reclassified: string[];
}

/**
 * Sources that were never extracted from a document.
 *
 * GitHub issues are built from API JSON by `knowledgeFromIssue`, and verified
 * fixes are written by the feedback loop. Their cache entries are not documents,
 * so re-extracting them would replace real knowledge with noise.
 */
function isExtractedSource(source: SourceRef): boolean {
  if (source.sourceType === 'verified_fix' || source.sourceType === 'official_issue') return false;
  return source.url.startsWith('http') && !source.url.startsWith('https://api.github.com/');
}

/** Groups the index by the document each object was extracted from. */
function byDocument(knowledge: KnowledgeObject[]): Map<string, KnowledgeObject[]> {
  const groups = new Map<string, KnowledgeObject[]>();

  for (const item of knowledge) {
    const source = item.sources[0];
    if (!source || !isExtractedSource(source)) continue;

    const bucket = groups.get(source.url) ?? [];
    bucket.push(item);
    groups.set(source.url, bucket);
  }

  return groups;
}

export async function reindexFromCache(options: ReindexOptions = {}): Promise<ReindexResult> {
  const store = options.store ?? getStore();
  const all = await store.all();
  const scoped = options.package ? all.filter((item) => item.package === options.package) : all;

  const result: ReindexResult = {
    documents: 0,
    missing: 0,
    extracted: 0,
    removed: [],
    removalsHeld: false,
    reclassified: [],
  };

  const produced: KnowledgeObject[] = [];
  const survivors = new Set<string>();
  const reviewed: KnowledgeObject[] = [];

  for (const [url, existing] of byDocument(scoped)) {
    // `retrievalUrl` is where the body came from; `url` is what a reader is
    // shown. Taken from whichever object recorded one — a group can mix objects
    // written before the field existed with objects written after.
    const retrieval = existing.map((item) => item.sources[0]?.retrievalUrl).find(Boolean);
    const cached = (await readCache(url)) ?? (retrieval ? await readCache(retrieval) : null);
    if (!cached) {
      result.missing++;
      continue;
    }

    result.documents++;
    reviewed.push(...existing);

    // The context is rebuilt from what the objects themselves recorded. Any of
    // them will do — they all came from this one document.
    const [representative] = existing;
    const source = representative.sources[0];

    const normalized = normalizeDocument(cached.body, cached.contentType, source.title ?? url);
    const extracted = extractKnowledge(normalized, {
      package: representative.package,
      ecosystem: representative.ecosystem,
      documentVersion: representative.introduced ?? representative.toVersion,
      fromVersion: representative.fromVersion,
      toVersion: representative.toVersion,
      // Replay, not a budgeted fetch. Under the default cap a long CHANGELOG
      // reproduces only its first 60 claims, so every later claim looks deleted
      // and `--prune-missing` would throw away real knowledge.
      maxClaims: REPLAY_MAX_CLAIMS,
      source: { ...source, retrievedAt: cached.retrievedAt, contentHash: cached.contentHash },
    });

    for (const item of extracted) {
      produced.push(item);
      survivors.add(item.fingerprint);

      // Matched on title, not fingerprint: the fingerprint includes the type, so
      // a reclassified claim never matches its own former self.
      const before = existing.find((old) => old.title === item.title);
      if (before && before.type !== item.type) {
        result.reclassified.push(`${item.title.slice(0, 60)}: ${before.type} -> ${item.type}`);
      }
    }
  }

  const deduped = deduplicate(produced);
  result.extracted = deduped.knowledge.length;

  // Only drop an object the new rules did not reproduce, and only when this
  // document was its sole support. A claim corroborated elsewhere is not this
  // pass's to delete.
  const doomed = reviewed.filter((item) => !survivors.has(item.fingerprint) && item.sources.length === 1);
  result.removed = doomed.map((item) => `${item.type}: ${item.title.slice(0, 60)}`);
  result.removalsHeld = doomed.length > 0 && !options.pruneMissing;

  if (!options.dryRun) {
    if (doomed.length > 0 && options.pruneMissing) await store.remove(doomed.map((item) => item.id));
    if (deduped.knowledge.length > 0) await store.upsert(deduped.knowledge);
  }

  return result;
}
