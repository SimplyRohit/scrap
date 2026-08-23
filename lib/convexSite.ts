/**
 * Where the backend lives.
 *
 * Convex serves functions from `<deployment>.convex.cloud` and HTTP routes from
 * `<deployment>.convex.site`. The second is derived from the first rather than
 * configured separately, so a deployment can never be half-switched.
 */

export function convexSiteUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const deployment = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!deployment) return null;

  return deployment.replace(/\/+$/, '').replace(/\.convex\.cloud$/, '.convex.site');
}

/**
 * Hands a request to the Convex HTTP API and returns its answer verbatim.
 *
 * Used by the relay routes, whose URL is compiled into every published CLI —
 * `https://rift-cli.vercel.app/api/relay/*` has to keep answering, but the keys
 * it spends and the rate limit that bounds them now live in Convex. The status
 * is preserved because the client acts on it: 502 and 503 mean "stop asking".
 */
export async function forwardToConvex(request: Request, path: string): Promise<Response> {
  const origin = convexSiteUrl();

  if (!origin) {
    return Response.json(
      { error: 'This deployment has no relay credentials configured' },
      { status: 503 },
    );
  }

  // `x-forwarded-for` is what identifies the caller to the spend guard on the
  // other side; without it every request through this hop would share one
  // bucket keyed to Vercel.
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const forwarded = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
  if (forwarded) headers.set('x-forwarded-for', forwarded);

  try {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers,
      body: await request.text(),
      signal: AbortSignal.timeout(30_000),
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        ...(response.headers.get('retry-after')
          ? { 'Retry-After': response.headers.get('retry-after')! }
          : {}),
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Relay unavailable' },
      { status: 502 },
    );
  }
}
