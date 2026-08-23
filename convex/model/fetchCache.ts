'use node';

/**
 * The engine's `CacheBackend`, backed by Convex.
 *
 * `research/fetcher.ts` asks this for a cached copy before every network call.
 * The filesystem implementation it replaces is still what the CLI uses; both
 * obey the same freshness rules from `cachePolicy.ts`.
 */

import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';

import { shortHash } from '../../lib/engine/hash';
import type { CacheBackend } from '../../lib/engine/research/cache';
import type { CacheEntry } from '../../lib/engine/research/cachePolicy';

export function urlHash(url: string): string {
  return shortHash(url, 24);
}

export class ConvexCacheBackend implements CacheBackend {
  constructor(private readonly ctx: ActionCtx) {}

  async read(url: string): Promise<CacheEntry | null> {
    const entry = await this.ctx.runQuery(internal.fetchCache.lookup, { urlHash: urlHash(url) });
    if (!entry) return null;

    const blob = await this.ctx.storage.get(entry.body);
    // The row outliving its file means someone deleted the file by hand; treat
    // it as a miss rather than failing the research run.
    if (!blob) return null;

    return {
      url: entry.url,
      status: entry.status,
      body: await blob.text(),
      contentType: entry.contentType,
      contentHash: entry.contentHash,
      etag: entry.etag,
      lastModified: entry.lastModified,
      retrievedAt: entry.retrievedAt,
      transport: entry.transport,
    };
  }

  async write(entry: CacheEntry): Promise<void> {
    const hash = urlHash(entry.url);
    const existing = await this.ctx.runQuery(internal.fetchCache.lookup, { urlHash: hash });

    // Revalidation writes the same bytes back with a newer timestamp. Storing
    // the body again would cost a file per 304, so only the age moves.
    if (existing && existing.contentHash === entry.contentHash) {
      await this.ctx.runMutation(internal.fetchCache.touch, {
        urlHash: hash,
        retrievedAt: entry.retrievedAt,
      });
      return;
    }

    const blob = new Blob([entry.body], { type: entry.contentType ?? 'text/plain' });
    const body = await this.ctx.storage.store(blob);

    await this.ctx.runMutation(internal.fetchCache.store, {
      url: entry.url,
      urlHash: hash,
      status: entry.status,
      contentType: entry.contentType,
      contentHash: entry.contentHash,
      etag: entry.etag,
      lastModified: entry.lastModified,
      retrievedAt: entry.retrievedAt,
      transport: entry.transport,
      body,
      bytes: blob.size,
    });
  }
}
