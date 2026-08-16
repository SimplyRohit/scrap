---
name: upgrade-intelligence
description: Research what breaks before upgrading a dependency, and diagnose errors that a version change caused. Use when upgrading a package, when a build/test fails after a dependency change, or when asked what a version bump will break.
---

# Upgrade Intelligence

Answers two questions with cited evidence: **what will this upgrade break in this
repository**, and **what does this error mean for this package version**.

Every finding carries the verbatim sentence it came from and a confidence score.
Findings below 75% confidence are hypotheses, not facts.

## When upgrading a dependency

```bash
upgrade-intel migrate <package> --from <current> --to <target> --json
```

Then:

1. Read `risk` and `knowledge[]`. Act only on entries where `isBreaking` applies
   and `confidence >= 0.75`.
2. Find the real usage before changing anything:
   ```bash
   upgrade-intel repo . --packages <package> --json
   ```
   Use `affectedFiles` and `affectedSymbols`. If `usesPackage` is `false`, the
   upgrade cannot break this repository through its API — stop.
3. Apply the smallest change that the evidence supports. One breaking change at a time.
4. Validate: `bun test`, `bun run typecheck`, `bun run build` (or this repo's equivalents).
5. Report the outcome so the index learns (see below).

## When a command fails after a dependency change

```bash
upgrade-intel error \
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

## After applying a fix

Always report, whether it worked or not. A failed attempt is as useful as a
successful one — it stops the next agent repeating it.

```bash
upgrade-intel report \
  --package <package> \
  --version <version> \
  --summary "<what you changed>" \
  --derived-from <knowledge-id,...> \
  --tests passed --typecheck passed --build passed
```

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

## Other commands

```bash
upgrade-intel search "<query>" --package <p> --version <v>   # index only, never scrapes
upgrade-intel sources <package>                              # what would be researched
upgrade-intel index <package> --from <version>               # warm the index
upgrade-intel stats                                          # index size, capabilities
```

Add `--fail-on HIGH` to `migrate` or `repo` to exit `2` when risk reaches a
threshold — useful for gating CI.

## Interpreting confidence

| Score | Meaning | Action |
| --- | --- | --- |
| ≥ 0.90 | Multiple authoritative sources agree | Apply |
| 0.75–0.89 | One authoritative source, version-matched | Apply |
| 0.50–0.74 | Corroborated but not authoritative for this version | Verify first |
| < 0.50 | Weak or community-only | Report as a hypothesis; do not apply |

Knowledge produced by agents is capped at 0.6 until a validation run confirms it,
so it can never be mistaken for documentation.
