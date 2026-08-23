import { NextResponse, type NextRequest } from 'next/server';

import { initializeEngine } from '@/lib/engine/bootstrap';
import { checkRateLimit, callerKey } from '@/lib/engine/relayGuard';
import { VoyageEmbedder, voyageConfigured } from '@/lib/engine/index/voyage';

export const runtime = 'nodejs';

/** Matches `RelayEmbedder`'s declared width; the client rejects anything else. */
const MODEL = 'voyage-3.5-lite';

/** Inputs per request, mirroring the client's batch so one call maps to one call. */
const MAX_INPUTS = 48;

/** Per-input ceiling, so one caller cannot spend a batch's whole token budget. */
const MAX_CHARS = 20_000;

/**
 * POST /api/relay/embed — lends this deployment's Voyage key.
 *
 * A `VoyageEmbedder` is constructed per request rather than taken from the
 * engine's registry. The registry may hold a `RelayEmbedder` — that is exactly
 * what a deployment with `RIFT_RELAY_URL` set would have installed — and
 * serving from it would send the request straight back out again.
 *
 * The model is pinned here instead of read from the environment. The client
 * stores these vectors next to its knowledge and refuses to compare vectors
 * from different embedders, so changing the model on the server would silently
 * strand every vector already relayed.
 */
export async function POST(req: NextRequest) {
  const gate = checkRateLimit(callerKey(req.headers));
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'Relay rate limit reached. Set your own VOYAGE_API_KEY to bypass it.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSeconds) } },
    );
  }

  initializeEngine();
  if (!voyageConfigured()) {
    return NextResponse.json({ error: 'This deployment has no relay credentials configured' }, { status: 503 });
  }

  let inputs: unknown;
  let kind: unknown;
  try {
    ({ inputs, kind } = (await req.json()) as { inputs?: unknown; kind?: unknown });
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  if (!Array.isArray(inputs) || inputs.length === 0 || !inputs.every((item) => typeof item === 'string')) {
    return NextResponse.json({ error: 'Provide a non-empty `inputs` array of strings' }, { status: 400 });
  }
  if (inputs.length > MAX_INPUTS) {
    return NextResponse.json({ error: `At most ${MAX_INPUTS} inputs per request` }, { status: 400 });
  }

  try {
    const embedder = new VoyageEmbedder({ apiKey: process.env.VOYAGE_API_KEY!, model: MODEL });
    const embeddings = await embedder.embed(
      inputs.map((text) => text.slice(0, MAX_CHARS)),
      kind === 'query' ? 'query' : 'document',
    );

    return NextResponse.json({ embeddings, model: MODEL });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Relay embed failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
