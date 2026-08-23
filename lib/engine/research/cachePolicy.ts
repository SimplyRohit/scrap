/**
 * Fetch-cache freshness policy (gen.md section 22).
 *
 * Pure and Node-free: the Convex cache table and its pruning cron need these
 * rules just as much as the filesystem cache does, and they run in the Convex
 * runtime.
 */

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
export const TTL_MS: Record<SourceType, number> = {
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

/**
 * Longest any entry stays useful. Past this, no source type would still consider
 * a copy fresh, so a stored body is only costing space — the pruning cron uses
 * this as its cutoff.
 */
export const MAX_TTL_MS = Math.max(...Object.values(TTL_MS).filter((ttl) => Number.isFinite(ttl)));

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
