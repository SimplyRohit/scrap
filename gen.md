# Universal Package Migration & Error Intelligence Index

## Objective

Build a developer tool that automatically researches package/version changes, indexes migration knowledge, analyzes errors, and generates actionable upgrade instructions for an entire repository.

The system should work in two modes:

1. **Package Upgrade Mode**
   - Input: `package.json`, lockfile, or package/version range.
   - Detect package upgrades.
   - Scrape official documentation, changelogs, migration guides, GitHub releases/issues, API documentation, and other relevant sources.
   - Determine what changed between versions.
   - Identify breaking changes.
   - Generate structured Markdown migration documentation.
   - Index all gathered knowledge for future retrieval.

2. **Error Resolution Mode**
   - Input:
     - Error message/stack trace
     - Package name
     - Current version
     - Previous version / target version if available
     - Optional repository

   - Determine what the error is related to.
   - Search the indexed knowledge first.
   - If insufficient, dynamically scrape the web using Bright Data.
   - Correlate the error with package versions, breaking changes, GitHub issues, migration guides, commits, and documentation.
   - Produce a concrete fix/migration plan.
   - Optionally allow an LLM coding agent to apply the changes to the repository.

The final system should function as a **package migration and debugging knowledge engine for coding agents**.

---

# 1. Core Architecture

Design the system around these components:

```text
                    ┌─────────────────────┐
                    │     User / Agent     │
                    └──────────┬──────────┘
                               │
             ┌─────────────────┴─────────────────┐
             │                                   │
       Package Upgrade                      Error Input
             │                                   │
             ▼                                   ▼
   ┌───────────────────┐               ┌───────────────────┐
   │ Package Analyzer  │               │ Error Analyzer    │
   └─────────┬─────────┘               └─────────┬─────────┘
             │                                   │
             └─────────────────┬─────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │ Knowledge Retriever │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
              Existing Index          Web Research
                    │                     │
                    │                Bright Data
                    │                     │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │ Knowledge Processor │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │ Structured Knowledge│
                    │      Index          │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │ Migration / Fix Plan│
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │ LLM Coding Agent    │
                    │ Claude / Antigravity│
                    │ Cursor / etc.       │
                    └─────────────────────┘
```

---

# 2. Repository Structure

Create a clean modular architecture.

Suggested structure:

```text
src/
├── ingestion/
│   ├── package-json.ts
│   ├── lockfile.ts
│   ├── error.ts
│   ├── repository.ts
│   └── git.ts
│
├── research/
│   ├── brightdata.ts
│   ├── search.ts
│   ├── crawler.ts
│   ├── github.ts
│   ├── npm.ts
│   └── documentation.ts
│
├── analysis/
│   ├── version-diff.ts
│   ├── breaking-changes.ts
│   ├── error-correlation.ts
│   ├── migration-analysis.ts
│   └── confidence.ts
│
├── indexing/
│   ├── documents.ts
│   ├── chunks.ts
│   ├── embeddings.ts
│   ├── metadata.ts
│   ├── search.ts
│   └── storage.ts
│
├── agents/
│   ├── upgrade-agent.ts
│   ├── error-agent.ts
│   ├── repository-agent.ts
│   └── verification-agent.ts
│
├── skills/
│   ├── claude-code/
│   ├── antigravity/
│   ├── cursor/
│   └── generic/
│
├── output/
│   ├── markdown.ts
│   ├── migration-plan.ts
│   └── patches.ts
│
└── cli/
    └── index.ts
```

Keep scraping, indexing, analysis, retrieval, and agent execution separate.

---

# 3. Input Types

The system must accept multiple input types.

## Package JSON

Example:

```json
{
  "dependencies": {
    "prisma": "^6.0.0",
    "@prisma/client": "^6.0.0",
    "next": "^15.0.0"
  }
}
```

The system should compare this against:

- latest available version
- user-selected target version
- lockfile version
- previous Git commit
- installed version

---

## Explicit Package Upgrade

CLI/API:

```bash
upgrade-intel prisma 5.22.0 6.0.0
```

or:

```bash
upgrade-intel migrate prisma \
  --from 5.22.0 \
  --to 6.0.0
```

---

## Error

Example:

```bash
upgrade-intel error \
  --package prisma \
  --version 6.0.0 \
  --error "PrismaClientInitializationError: ..."
```

The input should support:

```json
{
  "package": "prisma",
  "version": "6.0.0",
  "previousVersion": "5.22.0",
  "error": "...",
  "stackTrace": "...",
  "environment": {
    "node": "22",
    "os": "darwin",
    "runtime": "bun"
  }
}
```

---

## Repository

Allow:

```bash
upgrade-intel repo .
```

The system should inspect:

- package.json
- lockfiles
- source code
- imports
- configuration files
- framework configuration
- TypeScript configuration
- generated code
- Docker files
- CI configuration
- environment usage
- package-specific configuration

---

# 4. Package Upgrade Detection

When given a repository, detect:

```text
package
current version
target version
version delta
dependency type
direct/transitive
```

Example:

```text
prisma
5.22.0 → 6.0.0
major upgrade
direct dependency
```

Then determine:

```text
breaking changes
deprecated APIs
removed APIs
renamed APIs
changed defaults
changed configuration
changed generated code
changed CLI behavior
changed runtime requirements
changed TypeScript types
changed database behavior
changed environment variables
```

---

# 5. Research Engine

Use Bright Data as the web acquisition layer.

Do NOT blindly scrape random search results.

Research should be source-prioritized.

Priority:

```text
1. Official migration guide
2. Official documentation
3. Official changelog
4. Official GitHub releases
5. Official GitHub commits
6. Official GitHub issues
7. Package registry
8. High-quality technical documentation
9. Stack Overflow / Reddit / community discussions
10. General web results
```

Each source must receive metadata:

```json
{
  "url": "...",
  "domain": "...",
  "sourceType": "official_docs",
  "package": "prisma",
  "version": "6.0.0",
  "retrievedAt": "...",
  "contentHash": "...",
  "trustScore": 0.95
}
```

---

# 6. Don't Just Scrape — Normalize

Raw scraped HTML must never be the primary knowledge representation.

Convert scraped information into normalized knowledge objects.

Example:

```json
{
  "type": "breaking_change",
  "package": "prisma",
  "fromVersion": "5.x",
  "toVersion": "6.x",
  "title": "...",
  "description": "...",
  "oldBehavior": "...",
  "newBehavior": "...",
  "affectedApis": [],
  "affectedConfig": [],
  "migration": [],
  "source": {
    "url": "...",
    "type": "official_migration_guide"
  },
  "confidence": 0.97
}
```

Other knowledge types:

```text
breaking_change
deprecated_api
removed_api
renamed_api
new_api
configuration_change
environment_change
cli_change
runtime_requirement
dependency_requirement
bug_fix
security_fix
performance_change
behavior_change
error_solution
migration_example
github_issue
github_commit
release_note
```

---

# 7. Error Intelligence

This is the most important feature.

When a user gives:

```text
Package: Prisma
Version: 6.0.0

Error:
PrismaClientInitializationError:
...
```

the system should NOT immediately search the exact error string only.

Create an error fingerprint.

Example:

```json
{
  "package": "prisma",
  "packageVersion": "6.0.0",
  "errorType": "PrismaClientInitializationError",
  "errorCode": "...",
  "message": "...",
  "stackSymbols": [],
  "environment": {},
  "fingerprint": "..."
}
```

Normalize:

- stack trace paths
- generated IDs
- memory addresses
- line numbers
- timestamps
- URLs
- random values
- project-specific paths

This allows semantically equivalent errors to map to the same knowledge.

---

# 8. Error Search Strategy

For every error, perform multiple searches.

### Search 1 — Exact error

```text
"PrismaClientInitializationError" "specific message"
```

### Search 2 — Error without project-specific data

```text
"PrismaClientInitializationError" "normalized message"
```

### Search 3 — Version-specific

```text
Prisma 6.0.0 "error"
```

### Search 4 — Migration-specific

```text
Prisma 5 to 6 "error"
```

### Search 5 — GitHub

```text
site:github.com/prisma/prisma "error"
```

### Search 6 — Documentation

```text
site:prisma.io "error"
```

### Search 7 — Semantic index

Search the internal knowledge base for:

```text
error embedding
package embedding
version embedding
API embedding
migration embedding
```

Combine lexical + semantic retrieval.

---

# 9. Version Awareness

Version must be a first-class property of the index.

Do not treat:

```text
Prisma error
```

as equivalent to:

```text
Prisma 5 error
Prisma 6 error
Prisma 7 error
```

Knowledge should have version ranges.

Example:

```json
{
  "package": "prisma",
  "introduced": "6.0.0",
  "fixed": "6.2.1",
  "affected": ">=6.0.0 <6.2.1"
}
```

This allows the engine to answer:

> "This error exists in your current version but was fixed in 6.2.1."

---

# 10. Package Knowledge Graph

Create relationships between entities.

Example:

```text
Prisma
 │
 ├── version 5.22
 │
 ├── version 6.0
 │      │
 │      ├── breaking change
 │      ├── removed API
 │      ├── changed configuration
 │      └── known error
 │
 └── version 6.2
        │
        └── fixes known error
```

Relationships:

```text
PACKAGE
VERSION
RELEASE
BREAKING_CHANGE
API
ERROR
ISSUE
COMMIT
MIGRATION
DOCUMENTATION
```

Relations:

```text
PACKAGE ──HAS_VERSION──> VERSION
VERSION ──HAS_RELEASE──> RELEASE
VERSION ──INTRODUCES──> BREAKING_CHANGE
BREAKING_CHANGE ──AFFECTS──> API
ERROR ──AFFECTS──> VERSION
ERROR ──FIXED_BY──> VERSION
ERROR ──RELATED_TO──> ISSUE
ISSUE ──RESOLVED_BY──> COMMIT
BREAKING_CHANGE ──DOCUMENTED_BY──> DOCUMENTATION
BREAKING_CHANGE ──REQUIRES──> MIGRATION
```

This can initially be implemented using relational tables plus vector search. Do not introduce a graph database unless there is a demonstrated need.

---

# 11. Indexing

Every normalized document should be indexed.

Store:

```text
id
package
packageVersion
versionRange
documentType
title
content
summary
sourceUrl
sourceType
publishedAt
retrievedAt
contentHash
trustScore
embedding
metadata
```

Use hybrid retrieval:

```text
BM25 / full-text search
+
vector similarity
+
metadata filtering
+
version filtering
+
package filtering
```

The final ranking should consider:

```text
semantic similarity
exact error match
package match
version match
source authority
recency
document type
```

---

# 12. Deduplication

The same migration information may appear in:

- changelog
- GitHub release
- docs
- blog
- Stack Overflow

Do not store all copies as independent knowledge.

Create a content fingerprint.

Also detect semantic duplicates.

Example:

```text
"foo() was removed"
"foo() has been removed"
"foo API no longer exists"
```

should be recognized as the same underlying change.

Keep multiple sources as evidence for the same knowledge object.

---

# 13. Evidence-Based Answers

Every recommendation must contain evidence.

Example:

````markdown
## Finding

`foo()` was removed in package v6.

### Why your repository breaks

Your repository still calls:

```ts
foo();
```
````

### Required migration

Replace:

```ts
foo();
```

with:

```ts
bar();
```

### Evidence

- Official migration guide
- Official release notes
- GitHub issue #1234

### Confidence

97%

````

Never let the LLM invent a migration.

If evidence is weak:

```text
Confidence: LOW

This is a likely cause, but no authoritative source confirms it.
````

---

# 14. Repository Correlation

The system should not stop at:

> "This API changed."

It must determine whether the user's repository actually uses that API.

Example:

```text
Breaking change:
Prisma.foo() removed

Repository:
src/db/user.ts
src/api/auth.ts
```

Search the repository for:

```text
imports
function calls
types
configuration
environment variables
CLI commands
scripts
generated files
```

Then produce:

```text
Affected files:

src/db/client.ts
src/api/users.ts
prisma/schema.prisma

Affected symbols:

PrismaClient
foo()
```

---

# 15. Migration Plan Generation

Generate a structured plan:

````markdown
# Migration Plan

## Package

Prisma

## Version

5.22.0 → 6.0.0

## Risk

HIGH

## Breaking Changes

1. ...
2. ...
3. ...

## Repository Impact

### src/db/client.ts

Uses deprecated API.

### src/api/users.ts

Uses changed API behavior.

## Required Changes

1. Replace ...
2. Update ...
3. Regenerate ...
4. Update configuration ...

## Validation

Run:

```bash
bun test
bun run typecheck
bun run build
```
````

## Rollback

Revert package versions and generated artifacts.

````

---

# 16. LLM Agent Integration

Create an agent protocol that allows coding agents to consume the knowledge.

The agent should receive:

```json
{
  "repository": "...",
  "packageChanges": [],
  "errors": [],
  "relevantKnowledge": [],
  "migrationPlan": [],
  "evidence": []
}
````

The coding agent's job is then:

```text
1. Inspect repository
2. Understand migration plan
3. Verify affected files
4. Apply changes
5. Run tests
6. Run typecheck
7. Run build
8. Re-check errors
9. Query knowledge engine again if needed
10. Produce final report
```

The agent should NEVER blindly modify the entire repository.

Changes must be based on detected impact.

---

# 17. Claude Code Skill

Generate a skill that can be installed into Claude Code.

Example:

```text
upgrade-intelligence/
├── SKILL.md
└── scripts/
    └── upgrade-intel
```

The skill should instruct Claude:

```text
When upgrading a dependency:

1. Detect package and version change.
2. Query Upgrade Intelligence.
3. Retrieve migration knowledge.
4. Inspect repository usage.
5. Identify affected files.
6. Create migration plan.
7. Apply minimal changes.
8. Run validation.
9. If an error occurs:
   a. Send error + package + version to Upgrade Intelligence.
   b. Retrieve evidence.
   c. Apply recommended fix.
   d. Re-run validation.
10. Never assume an API migration without evidence.
```

---

# 18. Antigravity / Generic Agent Skill

Also generate a generic skill that can be consumed by any coding agent.

Expose an MCP server or CLI if practical.

Example:

```bash
upgrade-intel search \
  --package prisma \
  --version 6.0.0 \
  --query "PrismaClientInitializationError"
```

Return:

```json
{
  "results": [],
  "confidence": 0.94,
  "recommendedAction": [],
  "sources": []
}
```

---

# 19. Automatic Error Loop

This should be the killer feature.

The agent is working on a repository.

It runs:

```bash
bun test
```

and gets:

```text
Error XYZ
```

The agent automatically calls:

```bash
upgrade-intel resolve-error \
  --package prisma \
  --version 6.0.0 \
  --error "..."
```

The engine:

```text
ERROR
 ↓
fingerprint
 ↓
internal index
 ↓
version filtering
 ↓
semantic retrieval
 ↓
if insufficient → Bright Data
 ↓
research
 ↓
normalize
 ↓
index
 ↓
rank evidence
 ↓
migration recommendation
```

The agent receives:

```json
{
  "diagnosis": "...",
  "likelyCause": "...",
  "fix": [],
  "affectedVersions": [],
  "fixedVersions": [],
  "repositoryImpact": [],
  "confidence": 0.96,
  "evidence": []
}
```

The agent applies the fix and runs the test again.

This creates:

```text
Code
 ↓
Error
 ↓
Knowledge Engine
 ↓
Fix
 ↓
Test
 ↓
Error?
 ├── No → Done
 └── Yes → Knowledge Engine again
```

---

# 20. Learning From Successful Fixes

When an agent successfully fixes an error, store the result.

Example:

```json
{
  "error": "...",
  "package": "prisma",
  "version": "6.0.0",
  "repositoryContext": "...",
  "diagnosis": "...",
  "fix": "...",
  "validation": {
    "tests": "passed",
    "typecheck": "passed",
    "build": "passed"
  }
}
```

However, distinguish:

```text
official knowledge
community knowledge
agent-generated knowledge
verified repository-specific knowledge
```

Agent-generated fixes must NOT automatically receive the same trust level as official documentation.

Increase confidence only after successful verification.

---

# 21. Knowledge Confidence

Implement confidence scoring.

Example:

```text
Official migration guide        +0.35
Official documentation          +0.25
Official GitHub issue           +0.15
Multiple independent sources    +0.10
Exact error match               +0.10
Exact version match             +0.10
Successful validation           +0.20
Community-only source           +0.03
Contradicting evidence          -0.20
```

Normalize to:

```text
0.00 - 1.00
```

Categories:

```text
0.90 - 1.00 = Very High
0.75 - 0.89 = High
0.50 - 0.74 = Medium
0.25 - 0.49 = Low
0.00 - 0.24 = Very Low
```

Do not present low-confidence guesses as facts.

---

# 22. Caching

Scraping should not happen unnecessarily.

Cache:

```text
URL
content hash
package
version
retrieval timestamp
ETag if available
Last-Modified if available
```

Before scraping:

```text
Does URL exist?
       │
       ├── Yes → Is cache fresh?
       │              │
       │              ├── Yes → use cache
       │              └── No → refresh
       │
       └── No → scrape
```

---

# 23. Incremental Indexing

Do not re-index everything.

If Prisma 6.0.0 was already indexed:

```text
Prisma 6.0.0
```

and a new request is:

```text
Prisma 6.0.0 error
```

reuse existing data.

Only perform additional research when:

```text
no matching knowledge
low confidence
new version
new error fingerprint
stale sources
contradicting information
```

---

# 24. Package JSON Should Become Just One Input

The existing JSON workflow must remain supported.

But architect the system around a general ingestion interface:

```ts
interface KnowledgeRequest {
  type: "package_upgrade" | "error" | "repository" | "query";

  package?: string;
  fromVersion?: string;
  toVersion?: string;
  version?: string;

  error?: string;
  stackTrace?: string;

  repository?: string;
}
```

This allows future integrations without redesigning the backend.

---

# 25. CLI

Implement:

```bash
upgrade-intel package prisma
```

```bash
upgrade-intel migrate prisma --from 5.22.0 --to 6.0.0
```

```bash
upgrade-intel error \
  --package prisma \
  --version 6.0.0 \
  --error "..."
```

```bash
upgrade-intel repo .
```

```bash
upgrade-intel search "PrismaClientInitializationError"
```

```bash
upgrade-intel index prisma
```

```bash
upgrade-intel sources prisma
```

---

# 26. API

Expose APIs such as:

```http
POST /api/research
POST /api/errors/analyze
POST /api/migrations/analyze
POST /api/repositories/analyze
POST /api/index
POST /api/search
POST /api/agent/resolve
```

Example:

```http
POST /api/errors/analyze
```

```json
{
  "package": "prisma",
  "version": "6.0.0",
  "error": "..."
}
```

Response:

```json
{
  "diagnosis": "...",
  "fix": [],
  "confidence": 0.94,
  "sources": [],
  "relatedVersions": [],
  "repositoryImpact": []
}
```

---

# 27. Markdown Output

Continue supporting your existing Markdown generation.

Generate:

```text
migration.md
breaking-changes.md
error-analysis.md
repository-impact.md
```

But Markdown should be an output format, NOT the database itself.

The canonical representation should be structured JSON/database records.

---

# 28. Important Design Principle

Do not build:

```text
JSON
→ scrape
→ giant Markdown
→ give Markdown to LLM
```

as the final architecture.

Build:

```text
INPUT
 ↓
RESEARCH
 ↓
NORMALIZATION
 ↓
STRUCTURED KNOWLEDGE
 ↓
INDEX
 ↓
RETRIEVAL
 ↓
EVIDENCE
 ↓
LLM
 ↓
MIGRATION / FIX
 ↓
VALIDATION
 ↓
LEARN
```

Markdown should simply be one representation generated from the structured knowledge.

---

# 29. Initial MVP

Do NOT attempt to build everything simultaneously.

Phase 1:

```text
package.json ingestion
        ↓
version detection
        ↓
Bright Data research
        ↓
official docs/changelog/GitHub
        ↓
breaking-change extraction
        ↓
structured JSON
        ↓
Markdown generation
```

Phase 2:

```text
vector + full-text index
        ↓
package/version/error search
```

Phase 3:

```text
error fingerprinting
        ↓
error → knowledge retrieval
        ↓
error → recommended fix
```

Phase 4:

```text
repository analysis
        ↓
breaking change → affected code
```

Phase 5:

```text
Claude Code / Antigravity skill
        ↓
automatic error → research → fix → test loop
```

Phase 6:

```text
verified fixes
        ↓
knowledge feedback
        ↓
continuously improving index
```

---

# 30. Success Criteria

The system is successful when the following workflow works:

### Scenario

User upgrades:

```text
Prisma 5.22 → 6.0
```

Agent detects an error:

```text
PrismaClientInitializationError: ...
```

Agent calls the knowledge engine.

The engine identifies:

```text
Package: Prisma
Current: 6.0.0

Likely cause:
Breaking change introduced in 6.0.0

Affected API:
...

Recommended migration:
...

Fixed in:
...

Confidence:
96%

Evidence:
Official migration guide
Official GitHub issue
Official release notes
```

The coding agent then:

```text
1. Finds affected source files.
2. Applies migration.
3. Regenerates Prisma client if required.
4. Runs tests.
5. Runs typecheck.
6. Runs build.
7. Confirms the error disappeared.
```

The final output should say:

```text
Migration completed.

Changed:
- src/db/client.ts
- src/api/users.ts

Reason:
Prisma 6 removed/changed X.

Validation:
✓ Tests
✓ Typecheck
✓ Build

Knowledge confidence:
96%

Sources:
...
```

---

# 31. Long-Term Vision

The final product should not be thought of as a scraper.

It should be treated as:

> **A continuously updated software-engineering knowledge index that connects package versions, breaking changes, errors, documentation, source code, and verified migrations.**

The important relationship is:

```text
Package
   ↓
Version
   ↓
Change
   ↓
Affected API
   ↓
Known Error
   ↓
Affected Repository Code
   ↓
Migration
   ↓
Verified Fix
```

This allows an LLM coding agent to move from:

> "I got an error."

to:

> "This error was introduced by version X, your repository uses the affected API in these three files, the official migration requires these changes, I applied them, and the test suite confirms the migration."

That should be the core product direction.
