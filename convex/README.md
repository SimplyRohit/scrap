# Backend

The Convex backend for Rift. The engine itself lives in
[`lib/engine`](../lib/engine/README.md) and is a library; this directory is where
it is given a database, a cache, a scheduler, and an API.

## Layout

| Path | Responsibility |
| --- | --- |
| `schema.ts` | Tables, indexes, the full-text index, and the vector index |
| `validators.ts` | Every argument, return and document validator, checked against the engine's types |
| `knowledge.ts` | The index API: public reads, internal writes |
| `analyses.ts` | Manifest runs — start, progress, report, and the worker queue |
| `graph.ts` | The package knowledge graph, re-derived per read (section 10) |
| `research.ts` | Research actions and the fan-out worker (Node runtime) |
| `manifests.ts` | Manifest parsing and target-version resolution (Node runtime) |
| `errors.ts` | Error diagnosis (Node runtime) |
| `agent.ts` | The agent protocol: resolve and report (Node runtime) |
| `embeddings.ts` | Voyage backfill, scheduled rather than inline |
| `relay.ts` | Bright Data and Voyage, lent to callers with no keys (Node runtime) |
| `relayLimits.ts` | The relay's spend guard, counted in the database |
| `fetchCache.ts` | Cached documents; bodies live in file storage |
| `maintenance.ts` | Reaping analyses whose worker died |
| `crons.ts` | Schedules for the maintenance jobs |
| `http.ts` | The HTTP API, for callers that cannot import a Convex client |
| `model/` | Shared logic. Public functions here are thin wrappers around it |

## How research runs

A manifest analysis is a queue, not a request:

1. `analyses.start` inserts one row per package and schedules a few workers.
2. `research.worker` claims one package, researches it, records the result, and
   reschedules itself. Each package therefore gets a full action time budget,
   concurrency stays at however many workers were launched, and one slow package
   cannot take the rest of the manifest with it.
3. The last package to finish finalizes the analysis, in the same transaction
   that recorded it.

The client subscribes to `analyses.get` and `analyses.blastRadius` throughout, so
the report fills in package by package instead of arriving all at once after five
minutes — which is what the HTTP route it replaced had to do.

Embedding is not part of that path. A free Voyage key allows three requests a
minute, so blocking a user's analysis on it would trade a fast answer for a
slightly better-ranked one; research schedules `embeddings.backfill` instead,
which embeds a batch, reschedules itself, and is a no-op once everything is
current.

## Retrieval

Lexical and semantic candidates are selected separately and ranked together:

- `knowledge.search` (a query) selects by package equality or the full-text
  index, and ranks with the engine's BM25 scorer.
- `ConvexKnowledgeStore.search` (in an action, so it can reach
  `ctx.vectorSearch`) adds the vector index's nearest neighbours and re-ranks the
  union.

Vectors carry the model that produced them. A vector from another model is worse
than no vector — it scores — so the vector index filters on `embeddingModel` and
the backfill treats a mismatch as work to redo.

## Where things run

Actions that reach the network carry `'use node'`: research uses `cheerio` and
`node:crypto`, neither of which exists in the Convex runtime. Queries and
mutations do not, and must not import anything that does — the engine keeps
retrieval, merge rules, and cache policy in Node-free modules for exactly this
reason, and `lib/__tests__/convexRuntime.test.ts` walks the import graph to prove
it before a push finds out.

`model/engine.ts` binds the engine's three seams — knowledge store, fetch cache,
embedder — to an action's `ctx` for the duration of one call.

## Conventions

- Every public function validates its arguments and its return value.
- Writes to the index are `internalMutation`s. Research and verified feedback are
  the only ways in, and both are actions.
- No `.filter()` on a table scan and no unbounded `.collect()`: every lookup goes
  through an index, and every list has a ceiling.
- Counters are maintained on write (`indexMeta`, `packageStats`), so reporting
  index statistics costs two document reads rather than a scan.

## Working on it

```bash
bunx convex dev     # push functions, watch for changes, keep _generated in sync
bun run dev         # the Next.js app, in another terminal
```

Deployment credentials are set on Convex, not in `.env.local`:

```bash
bunx convex env set BRIGHTDATA_API_KEY …
bunx convex env set BRIGHTDATA_SERP_ZONE …   # without it, discovery is skipped
bunx convex env set VOYAGE_API_KEY …
bunx convex env set GITHUB_TOKEN …
```

`_generated/` is committed — nothing typechecks without it. Regenerate it with
`bunx convex codegen` after adding or renaming a function.
