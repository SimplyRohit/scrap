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

  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new RelayError(`Relay ${path} failed (${response.status}): ${detail.slice(0, 200)}`, response.status);
  }

  return (await response.json()) as T;
}
