/**
 * Copy and sample data for the marketing site.
 *
 * The findings below are illustrative — real ones come out of the engine with
 * their own citations attached. They are kept here so the preview renders on
 * the server with no network call.
 */

export type { RiskLevel } from "@/components/ui/risk-badge";

import type { RiskLevel } from "@/components/ui/risk-badge";

export const HERO_STATS = [
  { value: 6, decimals: 0, label: "sources read per package" },
  { value: 0.75, decimals: 2, label: "confidence to assert" },
  { value: 139, decimals: 0, label: "tests over the engine" },
] as const;

export type ConsoleLine =
  | { kind: "prompt"; text: string }
  | { kind: "meta"; label: string; text: string }
  /** A fetch that only succeeded because it was unlocked. */
  | { kind: "unlock"; host: string; status: string; text: string }
  | { kind: "rule" }
  | {
      kind: "summary";
      pkg: string;
      range: string;
      risk: RiskLevel;
      score: string;
      breaking: string;
    }
  | { kind: "finding"; severity: RiskLevel; category: string; title: string }
  | { kind: "quote"; text: string }
  | { kind: "cite"; text: string; tier: string }
  | { kind: "exit"; text: string };

export const CONSOLE_LINES: ConsoleLine[] = [
  { kind: "prompt", text: "rift migrate next --from 13.4.19 --to 14.2.0" },
  {
    kind: "meta",
    label: "index",
    text: "no coverage for this window, researching",
  },
  { kind: "meta", label: "registry", text: "npm · resolved 14.2.0" },
  {
    kind: "unlock",
    host: "nextjs.org/docs/…/upgrading",
    status: "403",
    text: "unlocked",
  },
  {
    kind: "meta",
    label: "sources",
    text: "6 planned · 6 read · 2 unlocked · 2 from cache",
  },
  { kind: "rule" },
  {
    kind: "summary",
    pkg: "next",
    range: "13.4.19 → 14.2.0",
    risk: "HIGH",
    score: "82/100",
    breaking: "4 breaking",
  },
  { kind: "rule" },
  {
    kind: "finding",
    severity: "HIGH",
    category: "DEPENDENCY_CONFLICT",
    title: "Minimum Node.js version is now 18.17",
  },
  {
    kind: "quote",
    text: "The minimum Node.js version has been bumped from 16.14 to 18.17.",
  },
  {
    kind: "cite",
    text: "nextjs.org/docs/app/building-your-application/upgrading",
    tier: "official_docs",
  },
  {
    kind: "finding",
    severity: "MEDIUM",
    category: "DEFAULT_BEHAVIOR",
    title: "fetch() is no longer cached by default",
  },
  { kind: "quote", text: "Fetch requests are no longer cached by default." },
  { kind: "cite", text: "nextjs.org/blog/next-14", tier: "official_release" },
  { kind: "rule" },
  { kind: "meta", label: "wrote", text: ".rift/next/14.2.0/migration.md" },
  { kind: "exit", text: "exit 2 · risk HIGH reached the --fail-on threshold" },
];

export const EVIDENCE_STEPS = [
  {
    n: "01",
    title: "Read by authority",
    body: "Sources are planned before they are fetched: registry metadata, then official releases, then changelogs, migration guides, and finally issues. A blog post never outranks a release note.",
  },
  {
    n: "02",
    title: "Normalize, then extract",
    body: "HTML and Markdown are flattened into a section tree — the last place tags exist. Extraction turns that tree into knowledge objects, each pinned to the verbatim sentence that produced it.",
  },
  {
    n: "03",
    title: "Attest or stay quiet",
    body: "Every object keeps its quote, its URL, its authority tier, and a confidence score. A finding that cannot cite a source is not rendered — and “nothing found” always says how many sources were actually read.",
  },
] as const;

export const PIPELINE_STAGES = [
  { label: "INPUT", detail: "manifest, package, error" },
  // The one stage that leaves the machine, and the one that needs help doing it.
  {
    label: "RESEARCH",
    detail: "registry → releases → docs",
    note: "Bright Data",
  },
  { label: "NORMALIZE", detail: "HTML → section tree" },
  { label: "KNOWLEDGE", detail: "quote-anchored objects" },
  { label: "INDEX", detail: "BM25 + version filter" },
  { label: "RETRIEVAL", detail: "index before network" },
  { label: "EVIDENCE", detail: "quote, source, confidence" },
  { label: "OUTPUT", detail: "migration or fix plan" },
] as const;

export const MODES = [
  {
    index: "01",
    name: "Upgrade mode",
    lede: "Start from a manifest or a single package. Get back what changed, what breaks, and which of your files touch it.",
    command: "rift repo . --fail-on HIGH --markdown > migration.md",
    points: [
      "package.json, requirements.txt, pyproject.toml",
      "Lockfile overlay for the versions actually installed",
      "Delta classified as major, minor, or patch — then risk-scored",
      "Findings correlated to the files that import the symbol",
    ],
  },
  {
    index: "02",
    name: "Error mode",
    lede: "Paste the stack trace. The error is fingerprinted, matched against indexed knowledge, and researched only if that is not enough.",
    command:
      'rift error --package prisma --version 6.0.0 \\\n  --error "PrismaClientInitializationError: ..."',
    points: [
      "Application frames stripped before fingerprinting",
      "Correlated against breaking changes for that exact version",
      "Falls through to research when coverage is missing",
      "Returns a fix plan, or says plainly that it has none",
    ],
  },
] as const;

export const FINDINGS = [
  {
    name: "pydantic",
    from: "1.10.8",
    to: "2.6.4",
    ecosystem: "PyPI",
    risk: "CRITICAL" as RiskLevel,
    score: 94,
    breaking: 11,
    severity: "CRITICAL",
    category: "REMOVED_API",
    title: "BaseModel.dict() replaced by model_dump()",
    quote:
      "The .dict() method is deprecated and will be removed in a future version — use .model_dump() instead.",
    source: "Migration guide · docs.pydantic.dev",
    tier: "official_docs",
    symbols: ["BaseModel.dict", "BaseModel.json", "parse_obj"],
  },
  {
    name: "next",
    from: "13.4.19",
    to: "14.2.0",
    ecosystem: "npm",
    risk: "HIGH" as RiskLevel,
    score: 82,
    breaking: 4,
    severity: "HIGH",
    category: "DEPENDENCY_CONFLICT",
    title: "Minimum Node.js version raised to 18.17",
    quote:
      "The minimum Node.js version has been bumped from 16.14 to 18.17, since 16.x has reached end of life.",
    source: "Upgrade guide · nextjs.org",
    tier: "official_docs",
    symbols: ["engines.node"],
  },
  {
    name: "sqlalchemy",
    from: "1.4.48",
    to: "2.0.29",
    ecosystem: "PyPI",
    risk: "HIGH" as RiskLevel,
    score: 78,
    breaking: 7,
    severity: "HIGH",
    category: "REMOVED_API",
    title: "Query.get() is legacy; use Session.get()",
    quote:
      "The Query.get() method is considered legacy as of the 1.x series and becomes a legacy construct in 2.0.",
    source: "2.0 migration · docs.sqlalchemy.org",
    tier: "official_docs",
    symbols: ["Query.get", "Query.from_self"],
  },
  {
    name: "tailwindcss",
    from: "3.3.3",
    to: "4.0.0",
    ecosystem: "npm",
    risk: "HIGH" as RiskLevel,
    score: 71,
    breaking: 5,
    severity: "HIGH",
    category: "SIGNATURE_CHANGE",
    title: "@tailwind directives replaced by a CSS import",
    quote:
      "In v4 you import Tailwind with a regular CSS @import statement instead of the @tailwind directives.",
    source: "Upgrade guide · tailwindcss.com",
    tier: "official_docs",
    symbols: ["@tailwind base", "@tailwind utilities"],
  },
  {
    name: "react",
    from: "17.0.2",
    to: "18.3.1",
    ecosystem: "npm",
    risk: "MEDIUM" as RiskLevel,
    score: 58,
    breaking: 3,
    severity: "MEDIUM",
    category: "DEPRECATION",
    title: "ReactDOM.render replaced by createRoot",
    quote:
      "ReactDOM.render is no longer supported in React 18. Use createRoot instead.",
    source: "Release notes · react.dev",
    tier: "official_release",
    symbols: ["ReactDOM.render", "ReactDOM.hydrate"],
  },
  {
    name: "typescript",
    from: "4.9.5",
    to: "5.4.5",
    ecosystem: "npm",
    risk: "LOW" as RiskLevel,
    score: 22,
    breaking: 1,
    severity: "LOW",
    category: "DEFAULT_BEHAVIOR",
    title: "Decorators follow the ES proposal by default",
    quote:
      "TypeScript 5.0 implements the stage 3 decorators proposal; the legacy behaviour now requires experimentalDecorators.",
    source: "Release notes · typescriptlang.org",
    tier: "official_release",
    symbols: ["experimentalDecorators"],
  },
] as const;

export const SURFACES = [
  {
    index: "01",
    name: "Website",
    status: "Shipping",
    summary:
      "Paste a manifest, read the answer. The analyzer runs the same pipeline the CLI does and streams each package in as it lands, rather than making you wait for the slowest one.",
    points: [
      "Dashboard — what breaks, and how badly",
      "Sources — every page, and how it was fetched",
      "Report — Markdown, ready to paste into a PR",
    ],
    code: "localhost:3000/analyzer",
  },
  {
    index: "02",
    name: "Terminal",
    status: "Shipping",
    summary:
      "Fifteen commands, every one of them with --json, because the first consumer of this output is a coding agent and the second is CI. Everything else is built on this surface.",
    points: [
      "package · migrate · error · repo",
      "search · index · graph · sources",
      "backfill · prune · reindex · report",
      "mcp · stats · install-skill",
    ],
    code: "rift repo .",
  },
  {
    index: "03",
    name: "HTTP API",
    status: "Shipping",
    summary:
      "Twelve routes over the same engine, plus three that lend the deployment's Bright Data and Voyage keys to a caller with none. /api/search only ever answers from the index; research is a separate, explicit call.",
    points: [
      "/api/parse · /api/analyze",
      "/api/errors/analyze · /api/graph",
      "/api/agent/resolve · report",
      "Served from the deployment, not the web server",
    ],
    code: "POST …convex.site/api/analyze",
  },
  {
    index: "04",
    name: "MCP",
    status: "Shipping",
    summary:
      "The best door for an agent: six typed tools over stdio, no shell and no parsing. A failure comes back as data rather than as an exit code it has to guess at.",
    points: [
      "search_knowledge — what do we already know?",
      "analyze_error — why did this break?",
      "research_upgrade — what will this bump break?",
      "correlate_repository — which of my files use it?",
      "package_graph — which version fixes this?",
      "report_fix — that worked, remember it",
    ],
    code: "claude mcp add rift -- rift mcp",
  },
  {
    index: "05",
    name: "Agent skill",
    status: "Shipping",
    summary:
      "Not a new door — instructions that teach an agent when to open one, and how to read what comes back. A Claude Code skill, and a harness-agnostic AGENT.md for everything else.",
    points: [
      "skills/upgrade-intelligence",
      "skills/generic/AGENT.md",
      "Research, apply, then report whether it worked",
    ],
    code: "rift report --package next --summary ...",
  },
  {
    index: "06",
    name: "CI gate",
    status: "Shipping",
    summary:
      "One flag turns the engine into a pass/fail check, because a build needs a number rather than a table. Start at CRITICAL so day one is quiet, then tighten it.",
    points: [
      "exit 0 — fine",
      "exit 1 — something went wrong, reason on stderr",
      "exit 2 — risk hit your threshold",
    ],
    code: "rift repo . --fail-on HIGH --json",
  },
] as const;

/**
 * The three doors, and how to open each one — the README's "Three ways in".
 *
 * Kept next to the surfaces they install rather than in a docs page nobody
 * scrolls to: the reason someone reads that section is that they have decided
 * to try it, and the command should be under their cursor at that moment.
 */
export const INSTALL_STEPS = [
  {
    index: "01",
    name: "Terminal & CI",
    command: "npm i -g riftcli",
    body: "Install once and the command is rift — the npm name is riftcli, because rift on npm belongs to someone else.",
    then: "rift repo . --fail-on HIGH",
    note: "exit 2 when something reaches HIGH",
  },
  {
    index: "02",
    name: "Any MCP agent",
    command: "rift mcp",
    body: "The same engine over stdio. Arguments are typed, and a tool failure comes back as a result rather than as something to parse out of stderr.",
  },
  {
    index: "03",
    name: "Claude Code",
    command: "rift install-skill",
    body: "Installs the skill, and the agent reaches for rift on its own. Other harnesses want skills/generic/AGENT.md — the same engine, documented over HTTP.",
  },
] as const;

export const RULES = [
  {
    title: "Every claim carries its quote",
    body: "Extraction attaches the verbatim source sentence to each object. A finding that cannot cite cannot be rendered.",
  },
  {
    title: "Version is a hard filter, not a hint",
    body: "Knowledge scoped to >=16.3.0 is excluded from a 15.0.0 query outright, however well the text matches.",
  },
  {
    title: "Absence of evidence is reported as such",
    body: "“No breaking changes found” is always qualified with how many sources were actually read.",
  },
  {
    title: "Agent-written knowledge is capped",
    body: "0.6 confidence until validated, 0.85 when a repository verified it. Passing tests prove a change works in one place, not that it is the migration the maintainers intended.",
  },
  {
    title: "The index is consulted before the network",
    body: "Research runs only when coverage is missing or retrieval comes back insufficient.",
  },
] as const;

export const LIMITS = [
  {
    title: "Semantic retrieval needs a key",
    body: "With one, an error phrased nothing like the changelog still matches. Without one, ranking falls back to BM25 and the wording has to line up.",
  },
  {
    title: "Extraction is deterministic",
    body: "It classifies by heading, commit prefix, and prose pattern. It will not summarise or infer a migration the source never states.",
  },
  {
    title: "Not every usage site is parsed",
    body: "A site marked parsed came from the module graph and can be trusted. One marked textual is a lead — open the file before you edit it.",
  },
] as const;

export const FAQS = [
  {
    q: "How is this different from npm outdated or Dependabot?",
    a: "Those tell you a newer version exists. They cannot tell you that the version bump removes a method you call on line 40 of a file you forgot about. Rift reads what the maintainers wrote about the change and correlates it against your source.",
  },
  {
    q: "Where do the citations come from?",
    a: "From the document that was actually fetched. Sources are ranked by authority — registry metadata, official releases, changelogs, migration guides, then issues — and the quote stored with a finding is the sentence it was extracted from, not a paraphrase.",
  },
  {
    q: "What happens when a documentation site blocks you?",
    a: "It gets read anyway. Registries and GitHub answer plain requests, but a lot of documentation and changelog hosts return 403 to anything automated — and a source that cannot be fetched is a claim that cannot be cited. Those go through Bright Data's Web Unlocker, and the trace records which transport each source arrived on, so you can see exactly which findings depended on it. Search discovery uses the same account's SERP zone.",
  },
  {
    q: "Does it call an LLM?",
    a: "Not for extraction. The pipeline is deterministic end to end, which is why a finding can always be traced back to a sentence. There is a documented seam for a model pass that may improve wording, but it may not introduce claims.",
  },
  {
    q: "Does the index follow me between projects?",
    a: "Yes, and that is the point. What gets indexed is knowledge about a package, not about a repository, so it lives in ~/.upgrade-intel and every repo on the machine reads the same index. Solve a chalk error once and the next project already knows. A project that wants its own index opts in by creating a local .upgrade-intel directory.",
  },
  {
    q: "What happens when it is not confident?",
    a: "It stops short of telling you what to do. Below 0.75 confidence a finding is a hypothesis, so you get the diagnosis, the evidence, and a caveat — not a migration to apply. An agent reading the JSON sees the same threshold and is instructed to treat it the same way.",
  },
  {
    q: "What does it cost to run?",
    a: "Network, mostly. Sources are cached with per-type TTLs and revalidated with ETag or Last-Modified, and the index is consulted before anything is fetched, so a repeated run over the same manifest usually touches nothing.",
  },
  {
    q: "Which ecosystems work today?",
    a: "npm and PyPI — package.json with a lockfile overlay, requirements.txt, and pyproject.toml. GitHub releases, issues, and in-repo files are read for both.",
  },
  {
    q: "Can I gate CI on it?",
    a: "That is what --fail-on is for. rift repo . --fail-on HIGH exits 2 the moment a dependency reaches that risk level, and --json gives the build something to attach to the PR.",
  },
] as const;

/* ─────────────────────────────────────────────────────────────────────────────
   Diagram data
   ───────────────────────────────────────────────────────────────────────── */

/**
 * One document, one sentence, one knowledge object. The `lines` are rendered as
 * prose; the entry whose index is `quoteAt` is the sentence that gets marked.
 */
export const CLAIM_TRACES = [
  {
    file: "next-14.mdx",
    source: "nextjs.org/docs · upgrading",
    tier: "official_docs",
    lines: [
      "Upgrading from 13 to 14",
      "Next.js 14 is a focused release with no breaking changes for most apps.",
      "The minimum Node.js version has been bumped from 16.14 to 18.17.",
      "Run npx @next/codemod@latest upgrade to migrate automatically.",
    ],
    quoteAt: 2,
    object: {
      category: "DEPENDENCY_CONFLICT",
      scope: ">=14.0.0",
      symbol: "engines.node",
      confidence: 0.88,
    },
  },
  {
    file: "migration.md",
    source: "docs.pydantic.dev · migration",
    tier: "official_docs",
    lines: [
      "Migration guide — V1 to V2",
      "Model methods were renamed to avoid collisions with field names.",
      "The .dict() method is deprecated — use .model_dump() instead.",
      "A compatibility shim remains available under pydantic.v1.",
    ],
    quoteAt: 2,
    object: {
      category: "REMOVED_API",
      scope: ">=2.0.0",
      symbol: "BaseModel.dict",
      confidence: 0.93,
    },
  },
  {
    file: "release-18.0.0",
    source: "github.com/facebook/react · releases",
    tier: "official_release",
    lines: [
      "React 18.0.0",
      "Concurrent rendering is now opt-in through the new root API.",
      "ReactDOM.render is no longer supported in React 18. Use createRoot instead.",
      "Updates inside of timeouts and native handlers are now batched.",
    ],
    quoteAt: 2,
    object: {
      category: "DEPRECATION",
      scope: ">=18.0.0",
      symbol: "ReactDOM.render",
      confidence: 0.81,
    },
  },
] as const;

/** The authority ladder, highest first. Weight is what confidence scoring uses. */
export const SOURCE_TIERS = [
  {
    tier: "official_migration",
    label: "Migration guide",
    weight: 1.0,
    note: "Written for exactly this jump",
  },
  {
    tier: "official_release",
    label: "Release notes",
    weight: 0.9,
    note: "What the maintainers announced",
  },
  {
    tier: "official_changelog",
    label: "Changelog",
    weight: 0.85,
    note: "Per-version, usually terse",
  },
  {
    tier: "official_docs",
    label: "Documentation",
    weight: 0.75,
    note: "Current state, not the delta",
  },
  {
    tier: "registry",
    label: "Registry metadata",
    weight: 0.6,
    note: "Versions, dates, engines",
  },
  {
    tier: "community",
    label: "Issues & discussions",
    weight: 0.35,
    note: "Read last, never alone",
  },
] as const;

/** A stack trace as the fingerprinter sees it. */
export const ERROR_FRAMES = [
  {
    text: "TypeError: Cannot read properties of undefined (reading 'params')",
    kind: "head",
  },
  { text: "at Page (app/products/[id]/page.tsx:14:22)", kind: "app" },
  {
    text: "at renderWithHooks (node_modules/react-dom/cjs/react-dom.js:16305)",
    kind: "lib",
  },
  {
    text: "at beginWork (node_modules/react-dom/cjs/react-dom.js:19073)",
    kind: "lib",
  },
  {
    text: "at Object.invokeGuardedCallback (app/lib/render.ts:8:3)",
    kind: "app",
  },
] as const;

export const ERROR_RESULT = {
  fingerprint: "typeerror:undefined-read:params",
  matched: "next · 15.0.0 · SIGNATURE_CHANGE",
  quote:
    "params is now a Promise and must be awaited before its properties are read.",
  source: "nextjs.org/docs · dynamic-apis",
} as const;

/** What one upgrade actually reaches, ring by ring. */
export const RADIUS_RINGS = [
  {
    label: "Direct",
    note: "the package you bumped",
    nodes: ["next@14.2.0"],
  },
  {
    label: "Transitive",
    note: "packages that depend on it",
    nodes: ["eslint-config-next", "@next/font", "next-auth"],
  },
  {
    label: "Your source",
    note: "files that import a changed symbol",
    nodes: [
      "app/layout.tsx",
      "app/page.tsx",
      "lib/fetcher.ts",
      "middleware.ts",
    ],
  },
] as const;
