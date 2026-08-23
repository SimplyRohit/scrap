/**
 * Fetch cache (gen.md section 22).
 *
 * Scraping is the expensive, rate-limited, and rudest part of the system, so no
 * URL is fetched twice while its cached copy is fresh. When a copy is stale we
 * revalidate with ETag / Last-Modified rather than re-downloading blindly.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256, shortHash } from '../hash';
import { cacheDir, ensureDataDirs } from '../paths';
import type { SourceType } from '../knowledge';

export interface CacheEntry {
  url: string;
  status: number;
  body: string;
  contentType?: string;
  contentHash: string;
  etag?: string;
  lastModified?: string;
  retrievedAt: string;
  /**
   * How the body was obtained, for provenance reporting.
   *
   * `api` means the body came from a structured endpoint rather than the page
   * it is cited as — release notes are read from the GitHub releases listing
   * and cited as the release page. Storing it under the cited URL is what makes
   * the document re-readable later; calling it `direct` would be a lie.
   *
   * `relay` is an unlocker fetch that spent the deployed site's key instead of a
   * local one. It is kept distinct from `brightdata` for the same reason: the
   * body is identical, but who paid for it is not, and a run that leaned on the
   * relay should be able to say so.
   */
  transport: 'brightdata' | 'direct' | 'cache' | 'api' | 'relay';
}

/**
 * Freshness by source type. Migration guides and changelogs for a released
 * version are effectively immutable; issue threads move hourly.
 */
const TTL_MS: Record<SourceType, number> = {
  official_migration_guide: 7 * 24 * 3600_000,
  official_docs: 3 * 24 * 3600_000,
  official_changelog: 3 * 24 * 3600_000,
  official_release: 7 * 24 * 3600_000,
  official_commit: 30 * 24 * 3600_000,
  official_issue: 6 * 3600_000,
  package_registry: 3600_000,
  technical_docs: 3 * 24 * 3600_000,
  community: 24 * 3600_000,
  web: 24 * 3600_000,
  // Never fetched over the network — it exists only in our own index.
  verified_fix: Number.POSITIVE_INFINITY,
};

function cachePath(url: string): string {
  return path.join(cacheDir(), `${shortHash(url, 24)}.json`);
}

export async function readCache(url: string): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(cachePath(url), 'utf8');
    return JSON.parse(raw) as CacheEntry;
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
export async function writeCache(entry: CacheEntry): Promise<void> {
  try {
    await ensureDataDirs();
    await writeFile(cachePath(entry.url), JSON.stringify(entry, null, 2), 'utf8');
  } catch {
    // Nothing to recover: the caller already has the body.
  }
}

export function isFresh(entry: CacheEntry, sourceType: SourceType, now = Date.now()): boolean {
  const age = now - Date.parse(entry.retrievedAt);
  return Number.isFinite(age) && age < TTL_MS[sourceType];
}

/** Conditional-request headers so a stale-but-unchanged page costs a 304, not a scrape. */
export function revalidationHeaders(entry: CacheEntry | null): Record<string, string> {
  if (!entry) return {};
  const headers: Record<string, string> = {};
  if (entry.etag) headers['If-None-Match'] = entry.etag;
  if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  return headers;
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
