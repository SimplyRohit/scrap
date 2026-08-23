---
name: upgrade-intelligence
description: Research what breaks before upgrading a dependency, and diagnose errors that a version change caused. Use when upgrading a package, when a build/test fails after a dependency change, or when asked what a version bump will break.
---

# Upgrade Intelligence

Answers two questions with cited evidence: **what will this upgrade break in this
repository**, and **what does this error mean for this package version**.

Every finding carries the verbatim sentence it came from and a confidence score.
Findings below 75% confidence are hypotheses, not facts.

## Setup

The `rift` command must be on `PATH`, and it must find its credentials
from whatever directory you are working in.

```bash
npm i -g riftcli             # puts `rift` on PATH
rift stats                   # verify
```

`stats` prints a capability block. Every line should read `on`:

```
on   brightData        page fetching
on   brightDataSerp    web search discovery
on   github            5000 API calls/hour instead of 60
on   embeddings        semantic search
```

Anything `off` means a missing key. Keys live in `~/.upgrade-intel/.env`, not in
a project `.env.local`. A globally installed `rift` runs from whatever directory
you happen to be in, so a per-project env file is the wrong place to put them:

```
BRIGHTDATA_API_KEY=...
BRIGHTDATA_SERP_ZONE=...     # the SERP zone name from the Bright Data dashboard
GITHUB_TOKEN=...             # no scopes needed; public reads only
VOYAGE_API_KEY=...           # semantic search; lexical-only without it
```

Real environment variables win over that file, so CI and a shell export behave
the way they read.

### Where the index lives

`~/.upgrade-intel/` by default, shared by every repository — what is indexed is
knowledge about *packages*, not about one project, so an error diagnosed in one
repository is already answered in the next. A project overrides this by creating
its own `.upgrade-intel/` directory, or by setting `UPGRADE_INTEL_DATA_DIR`.

## When upgrading a dependency

```bash
rift migrate <package> --from <current> --to <target> --json
```

Then:

1. Read `risk` and `knowledge[]`. Act only on entries where `isBreaking` applies
   and `confidence >= 0.75`.
2. Find the real usage before changing anything:
   ```bash
   rift repo . --packages <package> --json
   ```
   Use `affectedFiles` and `affectedSymbols`. If `usesPackage` is `false`, the
   upgrade cannot break this repository through its API — stop.

   Each site carries how it was found. Treat them differently:

   | Field | Meaning | What to do |
   | --- | --- | --- |
   | `via: "parsed"` | The binding was resolved through the module graph | Trust it |
   | `via: "textual"` | A name matched in a file that imports the package | Open the file and confirm before editing |
   | `indirect: "via <file>"` | Reached through a barrel or re-export | Real, but the import you see is not the package |
   | `indirect: "computed access"` | Reached via `obj[name]` | A lead only — the engine could not resolve it |

   `scanned.parsed` and `scanned.unparsed` say how much of the repository got
   which treatment. A high `unparsed` count means the findings are weaker than
   they look.
3. Apply the smallest change that the evidence supports. One breaking change at a time.
4. Validate: `bun test`, `bun run typecheck`, `bun run build` (or this repo's equivalents).
5. Report the outcome so the index learns (see below).

## When a command fails after a dependency change

```bash
rift error \
  --package <package> \
  --version <version> \
  --error "<the error message>" \
  --stack "<stack trace if available>" \
  --json
```

The response gives `diagnosis`, `likelyCause`, `fix[]`, `affectedVersions`,
`fixedVersions`, `confidence`, and `evidence[]`.

If `fixedVersions` is non-empty and the repository is below that version,
upgrading is usually the correct fix rather than editing code.

An empty `fix[]` is not a failure. Migration steps are withheld below 0.75
confidence, so a well-evidenced 0.55 answer arrives as `likelyCause` and
`evidence[]` with no steps. Read the cause, verify it against the repository,
and write the change yourself — do not treat the empty array as "nothing known".

## After applying a fix

Always report, whether it worked or not. A failed attempt is as useful as a
successful one — it stops the next agent repeating it.

```bash
rift report \
  --package <package> \
  --version <version> \
  --error "<the same error text you resolved>" \
  --stack "<the same stack trace>" \
  --summary "<what you changed>" \
  --derived-from <knowledge-id,...> \
  --tests passed --typecheck passed --build passed
```

Pass `--error` and `--stack` exactly as you passed them to `error`. The report is
linked to the error by fingerprint; without them the verified fix is stored but
can never be retrieved by the error that produced it, and the next agent repeats
your work.

## Rules

- **Never invent a migration.** If no evidence names the API you are about to
  change, say so and stop. `confidence` below 0.75 means unconfirmed.
- **Never edit files the correlation step did not identify.** `affectedFiles` is
  the scope of the change.
- **A missing finding is not a safe finding.** "No breaking changes found" with
  zero sources read means the research failed, not that the upgrade is safe.
  Check `trace.fetched`.
- **Prefer upgrading to patching** when `fixedVersions` shows the bug is already fixed.
- Regenerate any generated artifacts (Prisma client, GraphQL types, protobufs)
  before concluding a migration failed.
- **Check `rift stats` before trusting a `search` miss.** If it reports
  `retrieval is lexical only`, a phrasing that differs from the changelog will not
  match, and "nothing found" means nothing was found *by keyword*. If it reports
  objects with no vector, run `rift backfill` first.

## Other commands

```bash
rift search "<query>" --package <p> --version <v>   # index only, never scrapes
rift sources <package>                              # what would be researched
rift index <package> --from <version>               # warm the index
rift graph <package> [--version <v>]                # what each version broke and what fixed it
rift backfill                                       # embed indexed knowledge for semantic search
rift prune                                          # list index entries the current rules reject
rift reindex [package]                              # re-extract cached documents under current rules
rift stats                                          # index size, capabilities
rift mcp                                            # serve the engine over MCP on stdio
```

`reindex` re-reads what is already in the fetch cache and re-extracts it under
today's rules. Use it after the extraction rules change; it costs no network and
no quota. It prints a dry run by default. `--apply` writes, and `--prune-missing`
also deletes what no longer reproduces — read the held list first, because a
claim can go missing for reasons other than being wrong.

`graph` is the fastest way to answer "which version fixes this" — it walks
`ERROR ─FIXED_BY→ VERSION` rather than re-reading every finding. It labels
`breaking:` separately from `change:`, so a release of bug fixes does not read
as a release of breakage.

Add `--fail-on HIGH` to `migrate` or `repo` to exit `2` when risk reaches a
threshold — useful for gating CI.

## As an MCP server

`rift mcp` speaks JSON-RPC over stdio, exposing the same engine as six
tools: `search_knowledge`, `analyze_error`, `research_upgrade`,
`correlate_repository`, `package_graph`, and `report_fix`.

Prefer this over shelling out when the harness supports MCP: the arguments are
typed, and a tool failure comes back as a result rather than as a non-zero exit
you have to parse.

## Interpreting confidence

| Score | Meaning | Action |
| --- | --- | --- |
| ≥ 0.90 | Multiple authoritative sources agree | Apply |
| 0.75–0.89 | One authoritative source, version-matched | Apply |
| 0.50–0.74 | Corroborated but not authoritative for this version | Verify first |
| < 0.50 | Weak or community-only | Report as a hypothesis; do not apply |

Knowledge produced by agents is capped at 0.6 until a validation run confirms it,
so it can never be mistaken for documentation.
