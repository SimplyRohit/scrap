/**
 * The HTTP API (gen.md section 26).
 *
 * Kept because the consumers of this system are coding agents and CI jobs, which
 * speak HTTP and cannot import a Convex client. Every route is a thin translation
 * of a function elsewhere in this directory — no logic lives here, so the HTTP
 * surface and the typed client surface can never disagree.
 *
 * Deployed at `https://<deployment>.convex.site`.
 */

import { ConvexError } from 'convex/values';
import { httpRouter } from 'convex/server';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction, type ActionCtx } from './_generated/server';
import { callerKey } from '../lib/engine/relayGuard';
import { checkRelayTarget } from '../lib/engine/relayTarget';

/** Whatever an external caller posted. Untyped by nature; every route validates what it uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = Record<string, any>;

/**
 * What a relay leg returns.
 *
 * The failure case carries a status because the client acts on it: 503 and 502
 * mean "this deployment will not serve this endpoint" and are remembered, while
 * a 429 is not.
 */
type RelayOutcome =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { ok: true; data: any }
  | { ok: false; status: number; error: string; detail?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Runs a handler and turns failures into the status they deserve.
 *
 * A `ConvexError` is a rejected request — bad input, missing field — and is the
 * caller's to fix, so it comes back as a 400. Anything else is ours, and is a
 * 500 with its message rather than a blank page.
 */
function route(handler: (ctx: ActionCtx, body: JsonBody) => Promise<unknown>) {
  return httpAction(async (ctx, request) => {
    let body: JsonBody = {};
    if (request.method !== 'GET') {
      try {
        body = (await request.json()) as JsonBody;
      } catch {
        return json({ error: 'Request body must be JSON' }, 400);
      }
    }

    try {
      return json(await handler(ctx, body));
    } catch (error) {
      if (error instanceof ConvexError) return json({ error: error.data }, 400);
      return json({ error: error instanceof Error ? error.message : 'Request failed' }, 500);
    }
  });
}

const http = httpRouter();

http.route({
  path: '/api/parse',
  method: 'POST',
  handler: route(async (ctx, body) =>
    ctx.runAction(api.manifests.parse, {
      content: body.content ?? '',
      fileName: body.fileName,
      lockfile: body.lockfile,
      resolve: body.resolve,
      refresh: body.refresh,
    }),
  ),
});

http.route({
  path: '/api/research',
  method: 'POST',
  handler: route(async (ctx, body) => {
    const from = body.fromVersion ?? body.version ?? body.from;
    if (!body.package) throw new ConvexError('Missing `package`');
    if (!from) throw new ConvexError('Missing `fromVersion` — the version to research changes since');

    return {
      success: true,
      ...(await ctx.runAction(api.research.packageUpgrade, {
        package: body.package,
        from,
        to: body.toVersion ?? body.to,
        ecosystem: body.ecosystem,
        refresh: body.refresh,
        maxDocuments: body.maxDocuments,
        includeMarkdown: body.includeMarkdown,
      })),
    };
  }),
});

/**
 * Starts a manifest analysis and returns immediately.
 *
 * This is the one route whose contract changed with the move to Convex, and
 * deliberately: research across a manifest routinely outlives an HTTP request,
 * so the work is scheduled and the caller polls `GET /api/analyses?id=` — or,
 * from the app, subscribes to `analyses.get` and watches it fill in.
 */
http.route({
  path: '/api/analyze',
  method: 'POST',
  handler: route(async (ctx, body) => {
    const parsed = body.manifest?.content
      ? await ctx.runAction(api.manifests.parse, {
          content: body.manifest.content,
          fileName: body.manifest.fileName,
          refresh: body.refresh,
        })
      : null;

    const packages =
      parsed?.packages ??
      (body.dependencies ?? []).map((item: JsonBody) => ({
        name: item.name,
        ecosystem: item.ecosystem,
        currentVersion: item.currentVersion,
        targetVersion: item.targetVersion || undefined,
        dependencyType: 'dependencies' as const,
        specifier: item.currentVersion,
      }));

    if (packages.length === 0) throw new ConvexError('Provide `dependencies` or `manifest.content`');

    const analysisId = await ctx.runMutation(api.analyses.start, {
      ecosystem: parsed?.ecosystem ?? packages[0].ecosystem,
      fileName: parsed?.fileName ?? 'dependencies',
      packages,
      refresh: body.refresh,
      maxDocuments: body.maxDocuments,
      warnings: parsed?.warnings,
    });

    return { success: true, analysisId, status: 'pending', poll: `/api/analyses?id=${analysisId}` };
  }),
});

http.route({
  path: '/api/analyses',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'Missing `id`' }, 400);

    const analysisId = id as Id<'analyses'>;

    try {
      const progress = await ctx.runQuery(api.analyses.get, { analysisId });
      if (!progress) return json({ error: `No analysis ${id}` }, 404);

      return json({
        ...progress,
        // The report is built from whatever has finished, so a slow package
        // delays its own row rather than the whole answer.
        analysis: await ctx.runQuery(api.analyses.blastRadius, { analysisId }),
      });
    } catch {
      // The only thing that can fail here is the id itself.
      return json({ error: `\`${id}\` is not an analysis id` }, 400);
    }
  }),
});

http.route({
  path: '/api/scrape',
  method: 'POST',
  handler: route(async (ctx, body) => {
    if (!Array.isArray(body.dependencies) || body.dependencies.length === 0) {
      throw new ConvexError('Missing dependencies array');
    }

    return {
      success: true,
      scrapedResults: await ctx.runAction(api.research.scrape, {
        dependencies: body.dependencies,
        refresh: body.refresh,
        maxDocuments: body.maxDocuments,
      }),
    };
  }),
});

http.route({
  path: '/api/search',
  method: 'POST',
  handler: route(async (ctx, body) =>
    ctx.runQuery(api.knowledge.searchWithConfidence, {
      text: body.text ?? body.query,
      package: body.package,
      ecosystem: body.ecosystem,
      version: body.version,
      types: body.types,
      minConfidence: body.minConfidence,
      errorType: body.errorType,
      limit: body.limit ?? 10,
    }),
  ),
});

http.route({
  path: '/api/index',
  method: 'GET',
  handler: route(async (ctx) => ctx.runQuery(api.knowledge.stats, {})),
});

http.route({
  path: '/api/index',
  method: 'POST',
  handler: route(async (ctx, body) => {
    if (body.action === 'backfill') {
      const backfill = await ctx.runAction(api.embeddings.runBackfill, { limit: body.limit });
      return {
        success: backfill.failures.length === 0,
        backfill,
        stats: await ctx.runQuery(api.knowledge.stats, {}),
      };
    }

    if (!body.package) throw new ConvexError('Missing `package`');
    if (!body.from) throw new ConvexError('Missing `from` — the version to index changes since');

    const result = await ctx.runAction(api.research.packageUpgrade, {
      package: body.package,
      from: body.from,
      to: body.to,
      ecosystem: body.ecosystem,
      refresh: body.refresh,
      maxDocuments: body.maxDocuments,
    });

    return {
      success: true,
      package: result.package,
      indexed: result.knowledge.length,
      change: result.change,
      trace: result.trace,
      warnings: result.warnings,
      stats: await ctx.runQuery(api.knowledge.stats, {}),
    };
  }),
});

http.route({
  path: '/api/errors/analyze',
  method: 'POST',
  handler: route(async (ctx, body) => {
    if (!body.package) throw new ConvexError('Missing `package`');
    if (!body.error) throw new ConvexError('Missing `error`');

    return ctx.runAction(api.errors.analyze, {
      package: body.package,
      error: body.error,
      version: body.version,
      previousVersion: body.previousVersion,
      stackTrace: body.stackTrace,
      ecosystem: body.ecosystem,
      environment: body.environment,
      repository: body.repository,
      indexOnly: body.indexOnly,
      refresh: body.refresh,
      maxDocuments: body.maxDocuments,
      includeMarkdown: body.includeMarkdown,
    });
  }),
});

http.route({
  path: '/api/agent/resolve',
  method: 'POST',
  handler: route(async (ctx, body) =>
    ctx.runAction(api.agent.resolve, {
      packageChanges: body.packageChanges,
      errors: body.errors,
      refresh: body.refresh,
      maxDocuments: body.maxDocuments,
      includeMarkdown: body.includeMarkdown,
    }),
  ),
});

http.route({
  path: '/api/agent/report',
  method: 'POST',
  handler: route(async (ctx, body) =>
    ctx.runAction(api.agent.report, {
      package: body.package,
      summary: body.summary,
      validation: body.validation ?? {},
      fix: body.fix,
      ecosystem: body.ecosystem,
      version: body.version,
      previousVersion: body.previousVersion,
      error: body.error,
      stackTrace: body.stackTrace,
      derivedFrom: body.derivedFrom,
      repository: body.repository,
    }),
  ),
});

http.route({
  path: '/api/graph',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const packageName = params.get('package');

    if (!packageName) {
      return json({ error: 'Provide `package` — the graph is scoped, not global' }, 400);
    }

    return json(
      await ctx.runQuery(api.graph.forPackage, {
        package: packageName,
        version: params.get('version') ?? undefined,
        errorFingerprint: params.get('errorFingerprint') ?? undefined,
      }),
    );
  }),
});

/**
 * The relay (gen.md section 5): this deployment's keys, lent to a caller who has
 * none.
 *
 * Published CLIs have `https://rift-cli.vercel.app` compiled in as their default
 * relay, and the Next.js routes at those paths now forward here — so this is the
 * implementation for both, and the only place the vendor keys live.
 */
async function relayGuarded(
  ctx: ActionCtx,
  request: Request,
  endpoint: string,
  run: (body: JsonBody) => Promise<RelayOutcome>,
): Promise<Response> {
  const gate = await ctx.runMutation(internal.relayLimits.consume, {
    caller: callerKey(request.headers),
    endpoint,
  });

  if (!gate.allowed) {
    return new Response(
      JSON.stringify({ error: 'Relay rate limit reached. Set your own key to bypass it.' }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(gate.retryAfterSeconds) },
      },
    );
  }

  let body: JsonBody;
  try {
    body = (await request.json()) as JsonBody;
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const result = await run(body);
  return result.ok ? json(result.data) : json({ error: result.error, detail: result.detail }, result.status);
}

http.route({
  path: '/api/relay/fetch',
  method: 'POST',
  handler: httpAction(async (ctx, request) =>
    relayGuarded(ctx, request, '/api/relay/fetch', async (body) => {
      // The route takes a URL from an anonymous caller and fetches it with our
      // credentials. Unchecked, that is a server-side request forgery primitive.
      const target = checkRelayTarget(body.url);
      if (!target.ok) return { ok: false, status: 400, error: target.reason ?? 'Invalid target' };

      return ctx.runAction(internal.relay.fetchPage, { url: body.url as string });
    }),
  ),
});

http.route({
  path: '/api/relay/search',
  method: 'POST',
  handler: httpAction(async (ctx, request) =>
    relayGuarded(ctx, request, '/api/relay/search', async (body) => {
      if (typeof body.query !== 'string' || body.query.trim() === '') {
        return { ok: false, status: 400, error: 'Provide a `query` string' };
      }

      return ctx.runAction(internal.relay.search, { query: body.query, limit: Number(body.limit) || undefined });
    }),
  ),
});

http.route({
  path: '/api/relay/embed',
  method: 'POST',
  handler: httpAction(async (ctx, request) =>
    relayGuarded(ctx, request, '/api/relay/embed', async (body) => {
      if (!Array.isArray(body.inputs) || !body.inputs.every((item: unknown) => typeof item === 'string')) {
        return { ok: false, status: 400, error: 'Provide a non-empty `inputs` array of strings' };
      }

      return ctx.runAction(internal.relay.embed, {
        inputs: body.inputs as string[],
        kind: body.kind === 'query' ? 'query' : 'document',
      });
    }),
  ),
});

/**
 * Repository correlation cannot run here.
 *
 * It answers "which of *your* files break", which means reading the caller's
 * working tree. A 501 that says where to get it is more useful than a 404 or,
 * worse, an answer computed against the wrong filesystem.
 */
http.route({
  path: '/api/repositories/analyze',
  method: 'POST',
  handler: httpAction(async () =>
    json(
      {
        error: 'Repository correlation needs local filesystem access.',
        alternatives: [
          'POST /api/repositories/analyze on a local `next dev` server, which can read the working tree.',
          'Run `upgrade-intel repo <path>` — the CLI reads the working tree and researches locally.',
          'POST /api/agent/resolve for the package and error analysis without file-level correlation.',
        ],
      },
      501,
    ),
  ),
});

export default http;
