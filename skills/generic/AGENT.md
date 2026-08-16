# Upgrade Intelligence — generic agent contract

For agents that are not Claude Code (Antigravity, Cursor, custom harnesses).
Two integration surfaces, same engine behind both.

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

## Obligations

1. **Do not apply a migration with no evidence.** If `evidence` is empty or every
   entry is below 0.75, report the uncertainty instead of guessing.
2. **Do not edit outside `affectedFiles`.** Correlation defines the blast radius.
3. **Do not treat an empty result as safety.** Check `trace.fetched` — zero
   sources read means research failed.
4. **Always report the outcome**, including failures. Refutations lower the
   confidence of bad knowledge; silence leaves it in place for the next agent.
5. **Do not re-run research in a loop.** The index answers repeats; only pass
   `refresh: true` when you have reason to believe the sources changed.

## MCP

Not implemented. The CLI's `--json` mode is the supported machine interface; an
MCP server would wrap the same calls in `cli/index.ts` and add a transport with
no new capability.
