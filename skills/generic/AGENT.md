# Upgrade Intelligence — generic agent contract

For agents that are not Claude Code (Antigravity, Cursor, custom harnesses).
Two integration surfaces, same engine behind both.

## Setup

```bash
cd <this repository> && bun link      # puts `upgrade-intel` on PATH
upgrade-intel stats                   # every capability should read `on`
```

Credentials go in `~/.upgrade-intel/.env`, not a project `.env.local`: `bun`
reads `.env.local` from the working directory, which is the wrong directory for
a globally installed CLI. Real environment variables win over that file.

```
BRIGHTDATA_API_KEY=...
BRIGHTDATA_SERP_ZONE=...     # SERP zone name from the Bright Data dashboard
GITHUB_TOKEN=...             # no scopes needed; public reads only
VOYAGE_API_KEY=...           # semantic search; lexical-only without it
```

The index lives in `~/.upgrade-intel/` and is shared by every repository — what
is indexed is knowledge about *packages*, not about one project. A project
overrides this with its own `.upgrade-intel/` directory or `UPGRADE_INTEL_DATA_DIR`.

## CLI

```bash
upgrade-intel <command> --json
```

Every command accepts `--json` and writes a single JSON object to stdout.
Diagnostics go to stderr. Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Usage or runtime error (message on stderr) |
| 2 | Risk threshold reached — only when `--fail-on <level>` was passed |

## HTTP

Run `bun run dev`, then:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/research` | Research one package upgrade |
| `POST /api/errors/analyze` | Diagnose an error |
| `POST /api/repositories/analyze` | Manifest + correlation for a repository |
| `POST /api/search` | Query the index; never scrapes |
| `POST /api/agent/resolve` | Package changes and errors in one call |
| `POST /api/agent/report` | Record a fix outcome |
| `GET /api/index` | Index statistics and capabilities |
| `POST /api/index` | Index a package, or `{"action":"backfill"}` to embed knowledge |
| `GET /api/graph` | Package knowledge graph; `?format=tree` for a readable diagram |

## The loop

```
run build/test
   ↓ failure
POST /api/errors/analyze   { package, version, error, stackTrace }
   ↓
inspect evidence[] — apply only confidence >= 0.75
   ↓
POST /api/repositories/analyze  → affectedFiles
   ↓
edit only those files
   ↓
re-run build/test
   ↓
POST /api/agent/report   { validation: { tests, typecheck, build }, derivedFrom }
```

## Response contract

`/api/agent/resolve` returns:

```jsonc
{
  "packageChanges": [{ "package", "change", "risk", "affectedFiles", "applicableChanges" }],
  "errors":         [{ "diagnosis", "likelyCause", "fix", "fixedVersions", "confidence", "caveat" }],
  "relevantKnowledge": [/* KnowledgeObject[] */],
  "migrationPlan":     [{ "package", "risk", "steps" }],
  "evidence":          [{ "knowledgeId", "url", "sourceType", "quotedText", "confidence" }],
  "instructions":      ["..."]
}
```

A `caveat` field on any item means the finding is **not** confirmed by an
authoritative source. Report it to the user; do not act on it silently.

## Correlation provenance

Every usage site in `affectedFiles`/`symbolSites` carries how it was found:

- `via: "parsed"` — resolved through the module graph. Renamed imports, namespace
  members, and barrel re-exports are followed to the package's real export name.
- `via: "textual"` — a name matched inside a file that imports the package. This
  is a lead. Confirm it before editing.
- `indirect` — reached through a barrel (`"via src/lib/barrel.ts"`) or a computed
  access (`"computed access"`). Real, but the import you see is not the package.

`scanned.parsed` versus `scanned.unparsed` tells you how much of the repository
was resolved rather than grepped.

## Retrieval

`GET /api/index` reports `capabilities.embeddings`. When it is `false`, `/api/search`
ranks lexically only and a query phrased differently from the changelog will miss —
an empty result means "no keyword match", not "no such change". When it is `true`
but `withEmbeddings < total`, run `POST /api/index {"action":"backfill"}` first.

## Obligations

1. **Do not apply a migration with no evidence.** If `evidence` is empty or every
   entry is below 0.75, report the uncertainty instead of guessing.
2. **Do not edit outside `affectedFiles`.** Correlation defines the blast radius.
3. **Do not treat an empty result as safety.** Check `trace.fetched` — zero
   sources read means research failed.
4. **Always report the outcome**, including failures, and include the same
   `error`/`stackTrace` you sent to `/api/errors/analyze`. The verified fix is
   linked to the error by fingerprint; report without them and it is stored but
   unreachable by the error that produced it. Refutations lower the confidence of
   bad knowledge; silence leaves it in place for the next agent.
5. **Do not re-run research in a loop.** The index answers repeats; only pass
   `refresh: true` when you have reason to believe the sources changed.

## MCP

```bash
upgrade-intel mcp
```

Serves the engine over MCP on stdio (JSON-RPC 2.0, newline-delimited, protocol
version `2025-06-18`). Prefer it over the CLI where the harness supports it:
arguments are typed, and a tool failure returns `isError: true` in the result
rather than a non-zero exit code to parse. Tools:

| Tool | Purpose |
| --- | --- |
| `search_knowledge` | Query the index. Never scrapes |
| `analyze_error` | Diagnose an error against a package version |
| `research_upgrade` | Research a version window. The expensive call |
| `correlate_repository` | Which files use the package, and how each site was resolved |
| `package_graph` | What each version broke, and what fixes a known error |
| `report_fix` | Record an outcome so the index learns |

This is a transport, not a capability. Every tool calls the same engine function
the matching CLI command calls, and the same obligations below apply through it.
`stdout` belongs to the protocol while the server runs; diagnostics go to stderr.
