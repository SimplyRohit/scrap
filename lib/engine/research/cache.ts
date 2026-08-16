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
import { CACHE_DIR, ensureDataDirs } from '../paths';
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
  /** How the body was obtained, for provenance reporting. */
  transport: 'brightdata' | 'direct' | 'cache';
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
  return path.join(CACHE_DIR, `${shortHash(url, 24)}.json`);
}

export async function readCache(url: string): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(cachePath(url), 'utf8');
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

export async function writeCache(entry: CacheEntry): Promise<void> {
  await ensureDataDirs();
  await writeFile(cachePath(entry.url), JSON.stringify(entry, null, 2), 'utf8');
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
