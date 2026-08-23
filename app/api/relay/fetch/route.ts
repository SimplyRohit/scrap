import { NextResponse, type NextRequest } from 'next/server';

import { initializeEngine } from '@/lib/engine/bootstrap';
import { checkRateLimit, callerKey } from '@/lib/engine/relayGuard';
import { checkRelayTarget } from '@/lib/engine/relayTarget';

export const runtime = 'nodejs';

const BRIGHTDATA_ENDPOINT = 'https://api.brightdata.com/request';
const DEFAULT_ZONE = 'web_unlocker1';
const TIMEOUT_MS = 25_000;

/**
 * POST /api/relay/fetch — lends this deployment's Bright Data key.
 *
 * The caller keeps the cache, the extraction, and the index; only the page
 * retrieval happens here. That is the whole reason this deployment needs no
 * durable storage, which is fortunate, because the serverless filesystem it
 * runs on has none.
 *
 * Only the unlocker transport is offered. A direct fetch would originate from
 * our network, turning this into an open proxy for anything the deployment can
 * reach; `checkRelayTarget` is the second line of that defence, not the first.
 */
export async function POST(req: NextRequest) {
  const gate = checkRateLimit(callerKey(req.headers));
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'Relay rate limit reached. Set your own BRIGHTDATA_API_KEY to bypass it.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSeconds) } },
    );
  }

  initializeEngine();
  if (!process.env.BRIGHTDATA_API_KEY) {
    return NextResponse.json({ error: 'This deployment has no relay credentials configured' }, { status: 503 });
  }

  let url: unknown;
  try {
    ({ url } = (await req.json()) as { url?: unknown });
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const target = checkRelayTarget(url);
  if (!target.ok) return NextResponse.json({ error: target.reason }, { status: 400 });

  try {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body = await response.text();

    // A failure upstream is reported as a failed relay, not as an empty page.
    // The client escalates to a direct fetch on a non-2xx, and it can only make
    // that choice if the status survives the hop.
    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${response.status}`, detail: body.slice(0, 200) },
        { status: 502 },
      );
    }

    return NextResponse.json({
      status: 200,
      body,
      contentType: response.headers.get('content-type') ?? undefined,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Relay fetch failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
