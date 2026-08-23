/**
 * Credential relay.
 *
 * Bright Data, its SERP zone, and Voyage are all paid keys. Requiring every user
 * to open three accounts before the first answer is the reason a keyless run
 * tops out at 35% confidence: without the unlocker npmjs.com answers 403, and
 * without SERP the migration guide is never discovered. Both of those are
 * `independentDomains` the confidence formula is counting.
 *
 * So the deployed site lends its keys. Only the three vendor calls travel; the
 * fetch cache, extraction, and the knowledge index all stay on the caller's
 * machine. That keeps the caller's manifest private, keeps their index warm
 * across runs, and means the server needs no durable storage — which matters,
 * because the serverless filesystem it runs on has none.
 *
 * A local key always wins. The relay is the fallback for someone who has not set
 * one, never an override of someone who has.
 */

/**
 * Origin used when `RIFT_RELAY_URL` is unset.
 *
 * `null` until the site is deployed under a domain we own. Pointing it at a
 * guess would add a failed round trip to every fetch on a keyless run, which is
 * strictly worse than having no relay at all. Set it to the deployed origin and
 * publish; nothing else has to change.
 */
const DEFAULT_RELAY_URL: string | null = null;

/** Per-request ceiling. The relay is a courtesy, not a long-poll endpoint. */
export const RELAY_TIMEOUT_MS = 30_000;

/**
 * Resolved relay origin, or undefined when there is none.
 *
 * `RIFT_RELAY_URL=off` opts out explicitly — an air-gapped or privacy-sensitive
 * caller needs a way to guarantee no traffic leaves for a third party, and
 * unsetting a variable cannot express that once a default exists.
 */
export function relayOrigin(): string | undefined {
  const explicit = process.env.RIFT_RELAY_URL?.trim();
  if (explicit === 'off') return undefined;
  const chosen = explicit || DEFAULT_RELAY_URL;
  if (!chosen) return undefined;
  return chosen.replace(/\/+$/, '');
}

export function relayConfigured(): boolean {
  return Boolean(relayOrigin());
}

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

/**
 * Endpoints this relay has already refused to serve.
 *
 * A deployment can hold some credentials and not others — the common case is a
 * SERP zone with no unlocker, because documentation sites do not block plain
 * requests and an unlocker zone is the expensive one to keep. Without this, a
 * single research run asked a relay that has no unlocker eighteen separate
 * times and fell back to a direct fetch eighteen times, paying a full round
 * trip for each refusal.
 *
 * Keyed by endpoint rather than globally: a relay with no unlocker still has a
 * working SERP zone, and giving up on all of it because one leg is unavailable
 * would throw away the half that raises confidence.
 *
 * Process-lifetime, and deliberately not persisted. A long-running `rift mcp`
 * would otherwise keep refusing an endpoint that came back hours ago.
 */
const unavailable = new Set<string>();

/** Whether this relay is known to be unable to serve an endpoint. */
export function relayUnavailable(path: string): boolean {
  return unavailable.has(path);
}

/** Test seam: the set outlives a single test otherwise. */
export function resetRelayAvailability(): void {
  unavailable.clear();
}

/**
 * Statuses that mean "this relay will not serve this endpoint", as opposed to
 * "not right now".
 *
 * 503 is the deployment saying it holds no credential for this leg. 502 is an
 * upstream refusal, which in practice is a missing or disabled zone — the
 * vendor reports that per request, so retrying it every time costs a round trip
 * and never succeeds. A 429 is explicitly excluded: that one does clear.
 */
function isPermanent(status: number | undefined): boolean {
  return status === 503 || status === 502;
}

/**
 * POSTs to a relay endpoint and returns the parsed body.
 *
 * Throws rather than returning null: each caller has a different fallback — the
 * fetcher escalates to a direct request, search degrades to no discovery — and
 * collapsing those into one silent empty result would hide a misconfigured
 * relay behind what looks like a package with no documentation.
 */
export async function relayPost<T>(path: string, payload: unknown, timeoutMs = RELAY_TIMEOUT_MS): Promise<T> {
  const origin = relayOrigin();
  if (!origin) throw new RelayError('No relay configured');
  if (unavailable.has(path)) throw new RelayError(`Relay ${path} is unavailable on this deployment`);

  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    if (isPermanent(response.status)) unavailable.add(path);
    const detail = await response.text().catch(() => '');
    throw new RelayError(`Relay ${path} failed (${response.status}): ${detail.slice(0, 200)}`, response.status);
  }

  return (await response.json()) as T;
}
