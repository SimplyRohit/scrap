'use node';

/**
 * Credential relay.
 *
 * Bright Data, its SERP zone, and Voyage are paid keys. Requiring every user to
 * open three accounts before their first answer is why a keyless run tops out
 * around 35% confidence: without the unlocker npmjs.com answers 403, and without
 * SERP the migration guide is never discovered — both of them `independentDomains`
 * the confidence formula is counting.
 *
 * So this deployment lends its keys. Only the vendor call travels: the caller
 * keeps their fetch cache, their extraction, and their index, which is what
 * keeps their manifest private and their index warm across runs.
 *
 * These are internal actions. The public surface is `http.ts`, which is where
 * the spend guard runs — no route reaches a vendor without passing it.
 */

import { v } from 'convex/values';

import { internalAction } from './_generated/server';
import { brightDataConfigured, serpConfigured } from '../lib/engine/capabilities';
import { VoyageEmbedder, voyageConfigured } from '../lib/engine/index/voyage';
import { searchWeb } from '../lib/engine/research/search';

const BRIGHTDATA_ENDPOINT = 'https://api.brightdata.com/request';
const DEFAULT_ZONE = 'web_unlocker1';
const TIMEOUT_MS = 25_000;

/** Matches `RelayEmbedder`'s declared width; the client rejects anything else. */
const EMBED_MODEL = 'voyage-3.5-lite';

/** Inputs per request, mirroring the client's batch so one call maps to one call. */
const MAX_INPUTS = 48;

/** Per-input ceiling, so one caller cannot spend a batch's whole token budget. */
const MAX_CHARS = 20_000;

const MAX_SEARCH_RESULTS = 10;

/**
 * Relay outcomes carry the status the client should see.
 *
 * 503 means this deployment holds no credential for that leg and 502 means the
 * vendor refused; the client remembers both and stops asking, which is the
 * difference between one wasted round trip and eighteen. Collapsing them into a
 * thrown error would lose that distinction.
 */
const failure = v.object({
  ok: v.literal(false),
  status: v.number(),
  error: v.string(),
  detail: v.optional(v.string()),
});

const succeeded = <T extends Parameters<typeof v.object>[0]>(fields: T) =>
  v.object({ ok: v.literal(true), data: v.object(fields) });

/**
 * Lends the Bright Data unlocker.
 *
 * Only the unlocker transport is offered. A direct fetch would originate from
 * this deployment's network, turning the relay into an open proxy for anything
 * it can reach — `checkRelayTarget` in `http.ts` is the second line of that
 * defence, not the first.
 */
export const fetchPage = internalAction({
  args: { url: v.string() },
  returns: v.union(
    succeeded({
      status: v.number(),
      body: v.string(),
      contentType: v.optional(v.string()),
      etag: v.optional(v.string()),
      lastModified: v.optional(v.string()),
    }),
    failure,
  ),
  handler: async (_ctx, args) => {
    if (!brightDataConfigured()) {
      return { ok: false as const, status: 503, error: 'This deployment has no relay credentials configured' };
    }

    try {
      const response = await fetch(BRIGHTDATA_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          zone: process.env.BRIGHTDATA_ZONE ?? DEFAULT_ZONE,
          url: args.url,
          format: 'raw',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const body = await response.text();

      // A failure upstream is reported as a failed relay, not as an empty page:
      // the client escalates to a direct fetch on a non-2xx, and it can only
      // make that choice if the status survives the hop.
      if (!response.ok) {
        return {
          ok: false as const,
          status: 502,
          error: `Upstream returned ${response.status}`,
          detail: body.slice(0, 200),
        };
      }

      return {
        ok: true as const,
        data: {
          status: 200,
          body,
          contentType: response.headers.get('content-type') ?? undefined,
          etag: response.headers.get('etag') ?? undefined,
          lastModified: response.headers.get('last-modified') ?? undefined,
        },
      };
    } catch (error) {
      return {
        ok: false as const,
        status: 502,
        error: error instanceof Error ? error.message : 'Relay fetch failed',
      };
    }
  },
});

/**
 * Lends the Bright Data SERP zone.
 *
 * Only URLs and titles cross back. The caller fetches and classifies what it
 * finds through its own pipeline, so nothing indexed on their machine carries a
 * citation this deployment invented.
 */
export const search = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.union(
    succeeded({ results: v.array(v.object({ url: v.string(), title: v.string(), snippet: v.string() })) }),
    failure,
  ),
  handler: async (_ctx, args) => {
    // Checked before calling, not after: `searchWeb` falls back to the relay
    // when no SERP zone is set, and on a deployment pointed at itself that
    // fallback is an infinite loop through the network.
    if (!serpConfigured()) {
      return { ok: false as const, status: 503, error: 'This deployment has no relay credentials configured' };
    }

    const limit = Number.isFinite(args.limit) && (args.limit ?? 0) > 0
      ? Math.min(args.limit!, MAX_SEARCH_RESULTS)
      : MAX_SEARCH_RESULTS;

    try {
      const results = await searchWeb(args.query, limit);
      return {
        ok: true as const,
        data: { results: results.map(({ url, title, snippet }) => ({ url, title, snippet })) },
      };
    } catch (error) {
      return {
        ok: false as const,
        status: 502,
        error: error instanceof Error ? error.message : 'Relay search failed',
      };
    }
  },
});

/**
 * Lends the Voyage key.
 *
 * A `VoyageEmbedder` is constructed per request rather than taken from the
 * engine's registry: the registry may hold a `RelayEmbedder`, and serving from
 * that would send the request straight back out again.
 *
 * The model is pinned here rather than read from the environment. Callers store
 * these vectors next to their knowledge and refuse to compare vectors from
 * different embedders, so changing the model here would silently strand every
 * vector already relayed.
 */
export const embed = internalAction({
  args: { inputs: v.array(v.string()), kind: v.optional(v.union(v.literal('document'), v.literal('query'))) },
  returns: v.union(succeeded({ embeddings: v.array(v.array(v.float64())), model: v.string() }), failure),
  handler: async (_ctx, args) => {
    if (!voyageConfigured()) {
      return { ok: false as const, status: 503, error: 'This deployment has no relay credentials configured' };
    }
    if (args.inputs.length === 0) {
      return { ok: false as const, status: 400, error: 'Provide a non-empty `inputs` array of strings' };
    }
    if (args.inputs.length > MAX_INPUTS) {
      return { ok: false as const, status: 400, error: `At most ${MAX_INPUTS} inputs per request` };
    }

    try {
      const embedder = new VoyageEmbedder({ apiKey: process.env.VOYAGE_API_KEY!, model: EMBED_MODEL });
      const embeddings = await embedder.embed(
        args.inputs.map((text) => text.slice(0, MAX_CHARS)),
        args.kind === 'query' ? 'query' : 'document',
      );

      return { ok: true as const, data: { embeddings, model: EMBED_MODEL } };
    } catch (error) {
      return {
        ok: false as const,
        status: 502,
        error: error instanceof Error ? error.message : 'Relay embed failed',
      };
    }
  },
});
