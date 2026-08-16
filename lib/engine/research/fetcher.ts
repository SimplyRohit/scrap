/**
 * Web acquisition layer (gen.md section 5).
 *
 * Bright Data is the transport for documentation sites that block or JS-render.
 * Structured JSON APIs (npm, PyPI, GitHub) are fetched directly — routing them
 * through an unlocker spends quota to retrieve something already machine-readable.
 * Every fetch goes through the cache first.
 */

import { hashBody, isFresh, readCache, revalidationHeaders, writeCache, type CacheEntry } from './cache';
import type { SourceType } from '../knowledge';

const BRIGHTDATA_ENDPOINT = 'https://api.brightdata.com/request';
const DEFAULT_ZONE = 'web_unlocker1';

/** Hosts that serve clean JSON and never need an unlocker. */
const DIRECT_HOSTS = new Set([
  'registry.npmjs.org',
  'api.github.com',
  'pypi.org',
  'raw.githubusercontent.com',
  'unpkg.com',
]);

export type Transport = 'auto' | 'direct' | 'brightdata';

export interface FetchOptions {
  sourceType: SourceType;
  refresh?: boolean;
  transport?: Transport;
  timeoutMs?: number;
}

export interface FetchResult extends CacheEntry {
  fromCache: boolean;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export function brightDataConfigured(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_KEY);
}

function chooseTransport(url: string, requested: Transport): 'direct' | 'brightdata' {
  if (requested === 'direct') return 'direct';
  if (requested === 'brightdata') return 'brightdata';

  if (!brightDataConfigured()) return 'direct';
  try {
    return DIRECT_HOSTS.has(new URL(url).hostname) ? 'direct' : 'brightdata';
  } catch {
    return 'direct';
  }
}

async function fetchDirect(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'upgrade-intel/0.1 (+package migration research)',
      Accept: 'text/html,application/json,text/markdown;q=0.9,*/*;q=0.8',
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });

  return { status: response.status, body: response.status === 304 ? '' : await response.text(), headers: response.headers };
}

async function fetchViaBrightData(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(BRIGHTDATA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      zone: process.env.BRIGHTDATA_ZONE ?? DEFAULT_ZONE,
      url,
      format: 'raw',
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new FetchError(`Bright Data request failed (${response.status}): ${body.slice(0, 200)}`, url, response.status);
  }
  return { status: 200, body, headers: response.headers };
}

/**
 * Fetches a document, preferring a fresh cache entry, then a conditional
 * revalidation, then a full fetch. Bright Data failures fall back to a direct
 * fetch so a misconfigured zone degrades coverage instead of breaking the run.
 */
export async function fetchDocument(url: string, options: FetchOptions): Promise<FetchResult> {
  const { sourceType, refresh = false, transport = 'auto', timeoutMs = 30_000 } = options;

  const cached = await readCache(url);
  if (cached && !refresh && isFresh(cached, sourceType)) {
    return { ...cached, transport: 'cache', fromCache: true };
  }

  const chosen = chooseTransport(url, transport);
  let result: { status: number; body: string; headers: Headers };
  let usedTransport: 'direct' | 'brightdata' = chosen;

  try {
    result =
      chosen === 'brightdata'
        ? await fetchViaBrightData(url, timeoutMs)
        : await fetchDirect(url, refresh ? {} : revalidationHeaders(cached), timeoutMs);
  } catch (error) {
    if (chosen === 'brightdata') {
      usedTransport = 'direct';
      result = await fetchDirect(url, {}, timeoutMs);
    } else {
      throw error instanceof FetchError
        ? error
        : new FetchError(error instanceof Error ? error.message : String(error), url);
    }
  }

  // Unchanged since last fetch — keep the cached body, refresh the timestamp.
  if (result.status === 304 && cached) {
    const revalidated: CacheEntry = { ...cached, retrievedAt: new Date().toISOString() };
    await writeCache(revalidated);
    return { ...revalidated, transport: 'cache', fromCache: true };
  }

  if (result.status >= 400) {
    throw new FetchError(`HTTP ${result.status} for ${url}`, url, result.status);
  }

  const entry: CacheEntry = {
    url,
    status: result.status,
    body: result.body,
    contentType: result.headers.get('content-type') ?? undefined,
    contentHash: hashBody(result.body),
    etag: result.headers.get('etag') ?? undefined,
    lastModified: result.headers.get('last-modified') ?? undefined,
    retrievedAt: new Date().toISOString(),
    transport: usedTransport,
  };

  await writeCache(entry);
  return { ...entry, fromCache: false };
}

/** Best-effort fetch: returns null instead of throwing, for optional sources. */
export async function tryFetchDocument(url: string, options: FetchOptions): Promise<FetchResult | null> {
  try {
    return await fetchDocument(url, options);
  } catch {
    return null;
  }
}
