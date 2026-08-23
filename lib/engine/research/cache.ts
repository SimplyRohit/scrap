/**
 * Fetch cache (gen.md section 22).
 *
 * Scraping is the expensive, rate-limited, and rudest part of the system, so no
 * URL is fetched twice while its cached copy is fresh. When a copy is stale we
 * revalidate with ETag / Last-Modified rather than re-downloading blindly.
 *
 * Storage sits behind `CacheBackend` for the same reason the knowledge index
 * does: the CLI caches to disk, the deployed backend caches in Convex. The
 * freshness rules themselves live in `cachePolicy.ts`, which stays Node-free.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256, shortHash } from '../hash';
import { cacheDir, ensureDataDirs } from '../paths';
import type { CacheEntry } from './cachePolicy';

export type { CacheEntry } from './cachePolicy';
export { TTL_MS, MAX_TTL_MS, isFresh, revalidationHeaders } from './cachePolicy';

export interface CacheBackend {
  read(url: string): Promise<CacheEntry | null>;
  write(entry: CacheEntry): Promise<void>;
}

export class FileCacheBackend implements CacheBackend {
  private pathFor(url: string): string {
    return path.join(cacheDir(), `${shortHash(url, 24)}.json`);
  }

  async read(url: string): Promise<CacheEntry | null> {
    try {
      return JSON.parse(await readFile(this.pathFor(url), 'utf8')) as CacheEntry;
    } catch {
      return null;
    }
  }

  /**
   * Best-effort by design.
   *
   * A cache that cannot be written is a slower cache. It is not a failed fetch —
   * the document is already in hand, and throwing here discards a page that was
   * successfully downloaded. On a read-only filesystem that turned every source
   * into a failure and every report into "No sources could be read", while the
   * network requests themselves were all succeeding.
   */
  async write(entry: CacheEntry): Promise<void> {
    try {
      await ensureDataDirs();
      await writeFile(this.pathFor(entry.url), JSON.stringify(entry, null, 2), 'utf8');
    } catch {
      // Nothing to recover: the caller already has the body.
    }
  }
}

let backend: CacheBackend | null = null;

export function getCacheBackend(): CacheBackend {
  backend ??= new FileCacheBackend();
  return backend;
}

export function setCacheBackend(next: CacheBackend | null): void {
  backend = next;
}

export async function readCache(url: string): Promise<CacheEntry | null> {
  return getCacheBackend().read(url);
}

export async function writeCache(entry: CacheEntry): Promise<void> {
  return getCacheBackend().write(entry);
}

export function hashBody(body: string): string {
  return sha256(body);
}

/**
 * Stores a body under the URL it is cited as.
 *
 * Release notes are read from the GitHub releases listing but cited as the
 * release page, so nothing holds that page's content. Offline re-extraction
 * looked for it and found an index full of documents it could not read.
 */
export async function cacheReleaseBody(url: string, body: string): Promise<void> {
  if (!body.trim()) return;

  await writeCache({
    url,
    status: 200,
    body,
    contentType: 'text/markdown',
    contentHash: sha256(body).slice(0, 32),
    retrievedAt: new Date().toISOString(),
    transport: 'api',
  });
}
