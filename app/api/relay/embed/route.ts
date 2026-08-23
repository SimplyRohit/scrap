import type { NextRequest } from 'next/server';

import { forwardToConvex } from '@/lib/convexSite';

export const runtime = 'edge';

/**
 * POST /api/relay/embed — kept as a forwarder.
 *
 * The relay itself moved to Convex, which is where the vendor keys are and
 * where the spend guard can be one counter instead of one per warm serverless
 * instance. This path stays because it is compiled into every published CLI as
 * the default relay origin, and breaking it would break `npx riftcli` for
 * everyone who never set a key.
 */
export async function POST(req: NextRequest) {
  return forwardToConvex(req, '/api/relay/embed');
}
