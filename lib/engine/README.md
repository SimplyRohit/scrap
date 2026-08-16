# Upgrade Intelligence engine

Structured knowledge engine for package migrations and error diagnosis. Implements
the pipeline from `gen.md` section 28:

```
INPUT -> RESEARCH -> NORMALIZATION -> STRUCTURED KNOWLEDGE -> INDEX
      -> RETRIEVAL -> EVIDENCE -> MIGRATION / FIX
```

Markdown is an output format. The canonical representation is the `KnowledgeObject`
in `knowledge.ts`, and nothing downstream reads generated Markdown back.

## Layout

| Path | Responsibility |
| --- | --- |
| `knowledge.ts` | Canonical knowledge model, source types, trust ladder |
| `request.ts` | `KnowledgeRequest` — the single ingestion interface (section 24) |
| `semver.ts` | Dependency-free semver subset: compare, delta, range satisfaction |
| `ingestion/manifest.ts` | package.json / requirements.txt / pyproject parsing, lockfile overlay |
| `ingestion/resolve.ts` | Target-version resolution against the registry |
| `research/fetcher.ts` | Bright Data transport, direct fallback, cache integration |
| `research/cache.ts` | Per-source-type TTLs, ETag / Last-Modified revalidation (section 22) |
| `research/sources.ts` | Source prioritisation and URL classification (section 5) |
| `research/registry.ts` | npm and PyPI clients |
| `research/github.ts` | Releases, issue search, in-repo files |
| `research/search.ts` | Bright Data SERP + the multi-angle query builders (section 8) |
| `analysis/normalize.ts` | HTML/Markdown to a section tree — the last place tags exist |
| `analysis/extract.ts` | Section tree to quote-anchored knowledge objects (section 6) |
| `analysis/dedupe.ts` | Fingerprint + semantic dedupe, evidence merging (section 12) |
| `analysis/confidence.ts` | Confidence scoring and assertion threshold (sections 13, 21) |
| `analysis/errorFingerprint.ts` | Error normalization and fingerprinting (section 7) |
| `analysis/repository.ts` | Repository correlation: which files actually use the change (section 14) |
| `analysis/versionDiff.ts` | Delta classification and risk assessment (section 4) |
| `index/store.ts` | Hybrid retrieval: BM25 + metadata + hard version filtering (section 11) |
| `index/embeddings.ts` | Embedder seam — Phase 2 |
| `feedback.ts` | Verified-fix write-back, reinforcement and refutation (section 20) |
| `pipeline.ts` | Upgrade research orchestration |
| `errorPipeline.ts` | Error resolution orchestration (sections 8, 19) |
| `output/markdown.ts` | `analysis.md`, `migration.md`, `breaking-changes.md`, `error-analysis.md`, `repository-impact.md` (section 27) |
| `adapters/legacy.ts` | Projection onto the existing blast-radius view model |

## HTTP API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/parse` | Manifest -> packages with registry-resolved targets |
| `POST /api/research` | Research one package upgrade, index the result |
| `POST /api/analyze` | Research a whole manifest, return the blast-radius view |
| `POST /api/scrape` | Acquisition only, no analysis |
| `POST /api/search` | Hybrid retrieval over the index. Never scrapes |
| `GET  /api/index` | Index statistics and capability report |
| `POST /api/index` | Index a package on demand |
| `POST /api/errors/analyze` | Diagnose an error against the index, research if insufficient |
| `POST /api/repositories/analyze` | Read a repo's manifest, research it, correlate findings to files |
| `POST /api/agent/resolve` | Agent protocol: package changes + errors in one call (section 16) |
| `POST /api/agent/report` | Write-back: record a fix outcome, reinforce or refute (section 20) |

## CLI

```bash
bun run cli -- <command>          # or ./skills/upgrade-intelligence/scripts/upgrade-intel
```

Commands follow gen.md section 25: `package`, `migrate`, `error`, `repo`,
`search`, `index`, `sources`, `report`, `stats`. Every command takes `--json`;
`--fail-on <level>` exits `2` when risk reaches a threshold, for CI gating.

Agent integrations live in `skills/` — `upgrade-intelligence/SKILL.md` for Claude
Code (section 17) and `generic/AGENT.md` for any other harness (section 18).

## Configuration

| Variable | Effect |
| --- | --- |
| `BRIGHTDATA_API_KEY` | Enables the Web Unlocker transport. Without it, all fetches are direct |
| `BRIGHTDATA_ZONE` | Unlocker zone. Defaults to `web_unlocker1` |
| `BRIGHTDATA_SERP_ZONE` | SERP zone. Without it, search discovery is skipped, not failed |
| `GITHUB_TOKEN` | Raises the GitHub API rate limit from 60/hour |
| `UPGRADE_INTEL_DATA_DIR` | Index and cache location. Defaults to `.upgrade-intel/` |

`GET /api/index` reports which of these are active.

## Tests

```bash
bun test lib/engine     # or: bun run test
bun run typecheck
```

139 tests. The pure units — semver, error fingerprinting, document normalization,
extraction, confidence, dedupe, the store, manifest parsing, repository
correlation, and feedback — are tested directly.

`pipeline.test.ts` covers orchestration (budget accounting, index-first
short-circuiting, release-selection fallbacks) by stubbing `globalThis.fetch`
rather than the engine's own modules, so the real cache, transport selection, and
parsing all still run. The response shapes it returns were taken from the live npm
and GitHub APIs; the point is to pin down decisions, not to re-test parsing.

Several tests are regressions for bugs found by doing exactly that, and are
labelled as such — CRLF release bodies collapsing a document into one empty
section, `/BREAKING/i` matching "breaking the build", bare `Error:` failing type
extraction, application stack frames leaking into fingerprints, and `upgrade`
matching prose in page metadata.

## Design rules

1. **Every claim carries its quote.** `extractKnowledge` attaches the verbatim
   source sentence to each object. A finding that cannot cite cannot be rendered.
2. **Version is a hard filter, not a hint.** Knowledge scoped to `>=16.3.0` is
   excluded from a 15.0.0 query outright.
3. **Absence of evidence is reported as such.** "No breaking changes found" is
   always qualified with how many sources were actually read.
4. **Agent-generated knowledge is capped** at 0.6 confidence until validation
   succeeds, and repository-verified knowledge at 0.85 unless an authoritative
   source agrees (section 20). Passing tests prove a change works in one place;
   they do not prove it is the migration the maintainers intended. A repository
   that already reported an outcome cannot raise confidence by reporting it again,
   and a refutation lowers confidence — which is why the store exposes `patch()`
   alongside `upsert()`, since `upsert()` only ever raises it.
5. **The index is consulted before the network.** Research runs only when
   coverage is missing or retrieval is insufficient (section 23).

## Known limitations

- **Retrieval is lexical only.** `index/embeddings.ts` defines the contract but no
  embedder is registered, so an error phrased differently from the changelog
  ("params should be awaited" vs "Dynamic APIs are now async") will not match.
  This is the Phase 2 seam: register an embedder, backfill, and `search()` blends
  a semantic score automatically.
- **Extraction is deterministic.** It classifies by heading, conventional-commit
  prefix, and prose pattern. It will not summarise or infer a migration that the
  source does not state. `refineWithModel` in `extract.ts` is the seam for an LLM
  pass, which may improve wording but may not introduce claims.
- **Repository correlation is regex-based, not AST-based.** Import sites gate
  symbol sites and comments/strings are blanked before matching, which removes
  most false positives — but re-exports, aliased imports (`import { render as r }`),
  and dynamic access (`obj[name]`) are missed. Treat `affectedFiles` as a strong
  lead, not a proof.
- **Confidence weights follow gen.md section 21 literally.** A single official
  source scores ~0.35 ("Low"), below the 0.75 assertion threshold, so
  single-source findings are presented as unconfirmed. Retune `confidence.ts` if
  that is stricter than you want.
