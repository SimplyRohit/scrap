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
import { relayConfigured, relayPost, relayUnavailable } from '../relay';

const BRIGHTDATA_ENDPOINT = 'https://api.brightdata.com/request';
const DEFAULT_ZONE = 'web_unlocker1';
const RELAY_FETCH_PATH = '/api/relay/fetch';

/** Hosts that serve clean JSON and never need an unlocker. */
const DIRECT_HOSTS = new Set([
  'registry.npmjs.org',
  'api.github.com',
  'pypi.org',
  'raw.githubusercontent.com',
  'unpkg.com',
]);

export type Transport = 'auto' | 'direct' | 'brightdata' | 'relay';

export interface FetchOptions {
  sourceType: SourceType;
  refresh?: boolean;
  transport?: Transport;
  timeoutMs?: number;
  /** Wait between same-route retries. Zero in tests, so they do not sleep. */
  retryDelayMs?: number;
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

type Route = 'direct' | 'brightdata' | 'relay';

/**
 * Which route to try first.
 *
 * An unlocker is only worth spending on a host that might block us, so the
 * JSON APIs stay direct either way. For everything else a local Bright Data key
 * is preferred over the relay: it is the caller's own quota, and it does not
 * tell a third party which packages they are researching.
 */
function chooseTransport(url: string, requested: Transport): Route {
  if (requested !== 'auto') return requested;

  // A relay that has already answered "no unlocker here" is not an unlocker.
  // Choosing it anyway would report the fetch as a failed relay attempt when
  // what actually happened is an ordinary direct fetch.
  const relayUsable = relayConfigured() && !relayUnavailable(RELAY_FETCH_PATH);
  const unlocker: Route | null = brightDataConfigured() ? 'brightdata' : relayUsable ? 'relay' : null;
  if (!unlocker) return 'direct';

  try {
    return DIRECT_HOSTS.has(new URL(url).hostname) ? 'direct' : unlocker;
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

interface RelayFetchResponse {
  status: number;
  body: string;
  contentType?: string;
  etag?: string;
  lastModified?: string;
}

/**
 * Fetches through the deployed site, which holds the unlocker key.
 *
 * The relay answers with plain fields rather than a proxied `Response`, so the
 * caching headers are rebuilt into a `Headers` here and the rest of this module
 * cannot tell which route produced the body.
 */
async function fetchViaRelay(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: string; headers: Headers }> {
  const result = await relayPost<RelayFetchResponse>(RELAY_FETCH_PATH, { url }, timeoutMs);

  const headers = new Headers();
  if (result.contentType) headers.set('content-type', result.contentType);
  if (result.etag) headers.set('etag', result.etag);
  if (result.lastModified) headers.set('last-modified', result.lastModified);

  return { status: result.status, body: result.body ?? '', headers };
}

/**
 * Statuses that say "this route did not work", rather than "this page is not
 * there". A 404 is an answer; a 403 or a 502 is an obstacle.
 */
function isWorthAnotherRoute(status: number): boolean {
  return status === 403 || status === 429 || status === 451 || status >= 500;
}

/**
 * Routes to try, in order.
 *
 * Bright Data falling back to direct was already here: a misconfigured zone
 * should cost coverage, not the run. The reverse was missing, and it is the
 * more common failure — a documentation host that blocks a plain request is the
 * whole reason the unlocker transport exists. An explicit `transport` is
 * honoured exactly, because a caller that names one is not guessing.
 */
function escalation(chosen: Route, requested: Transport): Route[] {
  if (requested !== 'auto') return [chosen];
  if (chosen === 'brightdata') return ['brightdata', 'direct'];

  // The relay is somebody else's deployment: it can be down, rate-limited, or
  // not deployed at all. Falling back to direct means a keyless caller is never
  // worse off than they were before a relay existed.
  if (chosen === 'relay') return ['relay', 'direct'];

  // A direct choice under `auto` means no unlocker of either kind is available,
  // or the host is one that rejects proxies. Neither has anywhere to escalate to.
  return ['direct'];
}

/**
 * Attempts per route.
 *
 * The hosts with no second route are the ones most likely to rate-limit:
 * GitHub allows 60 requests an hour without a token, and answers 403 or 429
 * when that runs out. One attempt turns a momentary limit into a missing
 * source for the whole run.
 */
const ATTEMPTS_PER_ROUTE = 2;

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * Fetches a document, preferring a fresh cache entry, then a conditional
 * revalidation, then a full fetch. A blocked or failing route escalates to the
 * other transport rather than failing the run.
 */
export async function fetchDocument(url: string, options: FetchOptions): Promise<FetchResult> {
  const { sourceType, refresh = false, transport = 'auto', timeoutMs = 30_000, retryDelayMs = 750 } = options;

  const cached = await readCache(url);
  if (cached && !refresh && isFresh(cached, sourceType)) {
    return { ...cached, transport: 'cache', fromCache: true };
  }

  const chosen = chooseTransport(url, transport);
  const headers = refresh ? {} : revalidationHeaders(cached);

  const attempt = async (via: Route) => {
    if (via === 'brightdata') return fetchViaBrightData(url, timeoutMs);
    if (via === 'relay') return fetchViaRelay(url, timeoutMs);
    return fetchDirect(url, headers, timeoutMs);
  };

  const routes = escalation(chosen, transport);

  let result: { status: number; body: string; headers: Headers } | null = null;
  let usedTransport: Route = chosen;
  let lastError: unknown = new FetchError(`No transport available for ${url}`, url);

  outer: for (const [index, via] of routes.entries()) {
    const isLastRoute = index === routes.length - 1;

    for (let tries = 1; tries <= ATTEMPTS_PER_ROUTE; tries++) {
      const isLastTry = tries === ATTEMPTS_PER_ROUTE;

      try {
        const attempted = await attempt(via);

        // A block or a server fault is an obstacle, not an answer. Retry the
        // same route once, then try the other one. A 404 is an answer and stops
        // here, or every speculative probe would cost four requests.
        if (isWorthAnotherRoute(attempted.status) && !(isLastRoute && isLastTry)) {
          lastError = new FetchError(`HTTP ${attempted.status} for ${url}`, url, attempted.status);
          if (isLastTry) continue outer;
          await sleep(retryDelayMs);
          continue;
        }

        result = attempted;
        usedTransport = via;
        break outer;
      } catch (error) {
        lastError = error;
        if (isLastTry) continue outer;
        await sleep(retryDelayMs);
      }
    }
  }

  if (!result) {
    throw lastError instanceof FetchError
      ? lastError
      : new FetchError(lastError instanceof Error ? lastError.message : String(lastError), url);
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
