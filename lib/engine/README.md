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
| `analysis/ast.ts` | TypeScript-parser module facts: bindings, member paths, re-exports |
| `analysis/repository.ts` | Repository correlation: which files actually use the change (section 14) |
| `analysis/versionDiff.ts` | Delta classification and risk assessment (section 4) |
| `index/store.ts` | Hybrid retrieval: BM25 + metadata + hard version filtering (section 11) |
| `index/embeddings.ts` | Embedder seam — provider-agnostic, degrades to lexical |
| `index/voyage.ts` | Voyage AI embedder: the only file that names a vendor |
| `index/backfill.ts` | Adds vectors to indexed knowledge, resumable and idempotent |
| `index/graph.ts` | Knowledge graph projected from the index (section 10) |
| `index/reindex.ts` | Re-extracts cached documents under current rules, offline |
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
| `POST /api/index` | Index a package on demand, or `{"action":"backfill"}` to embed |
| `upgrade-intel mcp` | The same engine over MCP on stdio (section 18) |
| `GET  /api/graph` | Package knowledge graph; `?format=tree` for the section 10 diagram |
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
| `VOYAGE_API_KEY` | Enables semantic retrieval. Without it, ranking is lexical only |
| `VOYAGE_MODEL` | Embedding model. Defaults to `voyage-3.5-lite` (1024 dimensions) |
| `VOYAGE_RPM` | Paces requests. Set to `3` on a key with no payment method on file |
| `VOYAGE_BATCH_TOKENS` | Tokens per request. Defaults to 7000, under the free 10K/min cap |
| `UPGRADE_INTEL_DATA_DIR` | Index and cache location. Defaults to `.upgrade-intel/` |

`GET /api/index` reports which of these are active.

## Tests

```bash
bun test lib/engine     # or: bun run test
bun run typecheck
```

259 tests. The pure units — semver, error fingerprinting, document normalization,
extraction, confidence, dedupe, the store, manifest parsing, repository
correlation, embeddings, the knowledge graph, error resolution, and feedback — are tested
directly.

`embeddings.test.ts` injects the HTTP call into the Voyage client and registers a
deterministic fake embedder, so the suite never needs a key and never touches the
network. What it pins is the behaviour under failure: a 401 is not retried, a 429
is, a chunk that fails leaves the vectors already written in place, and a vector
from a superseded model is ignored rather than scored.

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

- **Retrieval is hybrid only when a key is set.** With `VOYAGE_API_KEY`, queries
  and stored claims are embedded and `search()` blends a semantic score, so an
  error phrased differently from the changelog ("params should be awaited" vs
  "Dynamic APIs are now async") still matches. Without it, ranking is BM25 plus
  metadata, and that phrasing gap is a miss. Nothing fails either way: a missing
  key, a failed embedding request, or a vector from a superseded model all fall
  back to the lexical score rather than erroring or scoring noise.
- **Vectors are added after indexing, not during it.** Research must work with no
  embedder configured, so the pipelines write `embedding: null` and
  `backfillEmbeddings()` fills it in — automatically after `POST /api/index`, or
  on demand via `POST /api/index {"action":"backfill"}`. Until that runs, new
  knowledge is reachable lexically but not semantically.
- **The graph adds one node type the spec does not list.** Section 10 names
  `BREAKING_CHANGE` but nothing for a bug fix or a docs change, which is most of
  what a release contains. Filing those under `BREAKING_CHANGE` would make a
  release of 25 fixes read as 25 things that break you, and dropping them would
  make the graph report less than the index holds — so they become `change`
  nodes, with `knowledgeType` carrying what they actually are.
- **The knowledge graph is derived, never stored.** `index/graph.ts` projects the
  section 10 entities and relations out of the indexed knowledge objects on every
  request, so it cannot go stale and there is no second source of truth to
  reconcile. gen.md says not to reach for a graph database without demonstrated
  need, and there is none: the relations it names are already implied by fields
  the objects carry. The cost is that a relation nothing asserts does not exist —
  the graph knows what was extracted, not what is true.
- **Symptom and cause are retrieved separately.** An error message and the
  release note that explains it share almost no vocabulary, so ranked together
  the issue quoting the error always wins and the cause falls below the cut
  (measured on chalk 5.6.2: the release note ranked 15th of 23). `resolveError`
  runs a second, type-filtered query for breaking changes in the version window
  and prefers an authoritative cause over a community symptom — ordered by
  whether the change names the symbols the error actually named. A change about
  *other* APIs ranks below a general one, because "this package is now pure ESM"
  explains a missing member and "we removed `.hsl()`" does not.
- **Extraction rules tighten over time; the index does not follow.** Entries
  written before a rule was added stay until something rewrites them.
  `upgrade-intel prune` re-applies the housekeeping filter by title alone;
  `upgrade-intel reindex` re-extracts the documents still in the fetch cache, so
  reclassification costs nothing and needs no network. Neither is a full replay:
  reindex adds and reclassifies but will not delete without `--prune-missing`,
  because the claim budget alone can make a large changelog yield fewer claims
  the second time, and deleting on that basis loses real knowledge to an
  artefact. Documents no longer cached need `--refresh` re-research.
- **Extraction is deterministic.** It classifies by heading, conventional-commit
  prefix, and prose pattern. It will not summarise or infer a migration that the
  source does not state. `refineWithModel` in `extract.ts` is the seam for an LLM
  pass, which may improve wording but may not introduce claims.
- **Repository correlation parses what it can and greps the rest.** JavaScript
  and TypeScript modules are parsed with the TypeScript compiler API (parser only
  — no program, no type checker), so renamed imports (`import { render as r }`),
  namespace members, `require` destructuring, and barrel re-exports resolve to the
  name the package actually exports. Everything else — Python, config, single-file
  components, and any file that fails to parse — falls back to regex gated on
  import sites, where those cases are missed. Each site carries `via: 'parsed' |
  'textual'`, and `scanned.parsed` / `scanned.unparsed` say which path a file took.
  `typescript` is a devDependency: if it is absent the whole scan degrades to
  regex rather than failing. Computed access (`obj[name]`) and names shadowed by a
  local declaration are never resolved — they are flagged as indirect or dropped.
- **Confidence weights follow gen.md section 21 literally.** A single official
  source scores ~0.35 ("Low"), below the 0.75 assertion threshold, so
  single-source findings are presented as unconfirmed. Retune `confidence.ts` if
  that is stricter than you want.
