/**
 * Spend guard for the relay routes.
 *
 * The relay exists so a stranger needs no keys, which means the keys it spends
 * are ours. Without a ceiling, one script can drain a Bright Data balance in an
 * afternoon and every other user's run degrades to a 403 with no explanation.
 *
 * This is a per-instance counter, not a global one. A serverless deployment
 * runs many instances, so the real ceiling is this limit times however many are
 * warm — it bounds a single caller's burst, not the monthly bill. The bill is
 * bounded at the vendor, by a spend cap on the zone; do not mistake this for
 * that.
 */

const WINDOW_MS = 60_000;

/** Requests per caller per window, per instance. */
const DEFAULT_LIMIT = 30;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function limit(): number {
  const configured = Number(process.env.RIFT_RELAY_RATE_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LIMIT;
}

/**
 * Identifies the caller.
 *
 * `x-forwarded-for` is client-supplied and trivially spoofed, so this is a
 * courtesy bucket rather than a security control. It is still worth having:
 * the traffic that actually exhausts a quota is a loop that never thought to
 * forge a header.
 */
export function callerKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip') ?? 'unknown';
}

export interface GuardResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, now = Date.now()): GuardResult {
  // Expired buckets are dropped on read rather than on a timer: a serverless
  // instance can be frozen between requests, and a pending interval there
  // either never fires or fires late enough to be meaningless.
  for (const [existing, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(existing);
  }

  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit()) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test seam: the module-level map outlives a single test otherwise. */
export function resetRateLimits(): void {
  buckets.clear();
}
