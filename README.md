# Rift

Know what breaks before you upgrade. Point it at a `package.json`,
`requirements.txt`, or `pyproject.toml` and every dependency is researched
against its own changelogs, release notes, and migration guides — and every
finding comes back with the sentence it was found in.

```bash
npx riftcli repo .            # what breaks here, and in which files
npx riftcli error --package prisma --error "PrismaClientInitializationError: ..."
```

## Shape of the thing

```
lib/engine/    the engine: research, normalization, knowledge, retrieval (a library)
convex/        the backend: database, fetch cache, scheduler, relay, HTTP API
app/           the marketing site, and the analyzer subscribed to the backend
cli/           rift — the same engine, run locally
```

The engine leaves three things pluggable: where knowledge is stored, where
fetched documents are cached, and which embedder is registered. The CLI fills the
first two with the filesystem and works offline. The deployment fills them with
Convex.

## Running it

```bash
bun install
bunx convex dev     # first run creates a deployment and writes .env.local
bun run dev         # in another terminal
```

The credentials belong to the Convex deployment, not to `.env.local`, because
the actions that read them run there:

```bash
bunx convex env set BRIGHTDATA_API_KEY …     # unlocker, for hosts that answer 403
bunx convex env set BRIGHTDATA_SERP_ZONE …   # discovery; skipped without it
bunx convex env set VOYAGE_API_KEY …         # semantic retrieval
bunx convex env set GITHUB_TOKEN …           # raises the GitHub rate limit
```

Without them the engine still works — it fetches directly, skips discovery, and
ranks lexically rather than failing. `GET /api/index` reports what is configured.

## Why the backend is Convex

Researching a manifest takes minutes and is mostly waiting on other people's
servers. As an HTTP route that meant one request held open for five minutes,
returning everything or nothing.

Here an analysis is a queue instead: `analyses.start` writes a row per package
and returns an id, workers claim packages one at a time, and the analyzer
subscribes and watches the report fill in. A slow package delays its own row, not
the answer. The pieces that made that worth doing — a real index with full-text
and vector search over it, a cache with TTLs and a cron to enforce them, a
scheduler, and a transaction around "finish the last package and finalize the
run" — are all things the database already had.

It also gave the credential relay a rate limit that is one counter rather than
one per warm serverless instance.

## Documentation

- [`lib/engine/README.md`](lib/engine/README.md) — the engine, its design rules,
  and its known limitations
- [`convex/README.md`](convex/README.md) — the backend, and how research is
  scheduled
- `gen.md` — the specification everything above is numbered against

## Checks

```bash
bun run test
bun run typecheck
bun run lint
```

Retrieval of blocked documentation hosts is powered by
[Bright Data](https://brightdata.com); semantic retrieval by
[Voyage AI](https://voyageai.com).
