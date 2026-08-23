import { NextResponse, type NextRequest } from 'next/server';

import { initializeEngine } from '@/lib/engine/bootstrap';
import { checkRateLimit, callerKey } from '@/lib/engine/relayGuard';
import { searchWeb, serpConfigured } from '@/lib/engine/research/search';

export const runtime = 'nodejs';

const MAX_LIMIT = 10;

/**
 * POST /api/relay/search — lends this deployment's Bright Data SERP zone.
 *
 * Discovery is the half of the pipeline a keyless caller loses most visibly:
 * without it the migration guide is never found, so every claim rests on one
 * domain and confidence stops around 35% — below the threshold at which this
 * product is willing to assert anything.
 *
 * Only URLs and titles cross back. The caller fetches and classifies what it
 * finds through its own pipeline, so nothing indexed on their machine carries a
 * citation this server invented.
 */
export async function POST(req: NextRequest) {
  const gate = checkRateLimit(callerKey(req.headers));
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'Relay rate limit reached. Set your own BRIGHTDATA_SERP_ZONE to bypass it.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSeconds) } },
    );
  }

  initializeEngine();

  // Checked before calling, not after. `searchWeb` falls back to the relay when
  // no SERP zone is set, and on a deployment that also has `RIFT_RELAY_URL`
  // pointed at itself that fallback is an infinite loop through the network.
  if (!serpConfigured()) {
    return NextResponse.json({ error: 'This deployment has no relay credentials configured' }, { status: 503 });
  }

  let query: unknown;
  let limit: unknown;
  try {
    ({ query, limit } = (await req.json()) as { query?: unknown; limit?: unknown });
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  if (typeof query !== 'string' || query.trim() === '') {
    return NextResponse.json({ error: 'Provide a `query` string' }, { status: 400 });
  }

  const requested = Number(limit);
  const capped = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : MAX_LIMIT;

  try {
    const results = await searchWeb(query, capped);
    return NextResponse.json({
      results: results.map(({ url, title, snippet }) => ({ url, title, snippet })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Relay search failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
