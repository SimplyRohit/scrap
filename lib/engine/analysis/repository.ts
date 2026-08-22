/**
 * Repository correlation (gen.md section 14).
 *
 * "This API changed" is not actionable. This module answers the question that is:
 * does *your* repository use it, and where.
 *
 * Two strategies run, in order of confidence:
 *
 *   1. **Parsed.** JavaScript and TypeScript files are parsed, and every usage is
 *      recorded against the name the *source module* exports rather than the name
 *      this file happens to use. That is what makes `import { render as r }`,
 *      `import * as ns from 'pkg'`, and barrel re-exports resolve correctly.
 *   2. **Regex.** Everything else — Python, single-file components, config, and any
 *      file that fails to parse. Here import sites gate symbol sites, because a bare
 *      `render` or `parse` appears in every codebase and counting it would drown the
 *      real findings.
 *
 * `scanned.parsed` versus `scanned.unparsed` reports which file got which, so the
 * reader can tell a resolved answer from a textual one.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { KnowledgeObject } from '../knowledge';

import {
  isParseableModule,
  loadTypeScript,
  normalizeSymbol,
  packageAliases,
  parseModule,
  resolveRelative,
  specifierMatchesPackage,
  usageCandidates,
  type ModuleFacts,
  type RawUsage,
} from './ast';

export interface UsageSite {
  /** Repository-relative path. */
  file: string;
  line: number;
  /** The matched source line, trimmed and truncated. */
  text: string;
  symbol: string;
  /**
   * How this site was found. `parsed` means the binding was resolved through the
   * module graph; `textual` means a pattern matched the line.
   */
  via?: 'parsed' | 'textual';
  /**
   * Set when the site was reached through a computed access (`ns[name]`) or a
   * barrel, where the resolution is a strong lead rather than a certainty.
   */
  indirect?: string;
}

export interface RepositoryImpact {
  package: string;
  repository: string;
  /** False when nothing in the repository imports the package. */
  usesPackage: boolean;
  importSites: UsageSite[];
  symbolSites: UsageSite[];
  configSites: UsageSite[];
  environmentSites: UsageSite[];
  scriptSites: UsageSite[];
  /** Every distinct file touched by any site, most-affected first. */
  affectedFiles: string[];
  /** Symbols from the knowledge set that were actually found in the repository. */
  affectedSymbols: string[];
  /** Knowledge ids whose affected APIs appear in this repository. */
  applicableKnowledge: string[];
  scanned: {
    files: number;
    skipped: number;
    truncated: boolean;
    /** Files whose bindings were resolved by parsing. */
    parsed: number;
    /** Files matched textually — no parser, or the parse failed. */
    unparsed: number;
  };
}

const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo',
  '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', 'site-packages',
  'vendor', 'target', '.upgrade-intel', '.cache', '.svelte-kit',
]);

const SCANNED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.pyi', '.json', '.toml', '.yaml', '.yml', '.env', '.sh', '.bash',
  '.prisma', '.graphql', '.svelte', '.vue', '.astro',
]);

const CONFIG_FILENAMES = /^(dockerfile|makefile|procfile|\.env(\..+)?|\.npmrc|requirements.*\.txt)$/i;

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 4000;
const MAX_SITES_PER_CATEGORY = 200;
/** Re-export chains are shallow in practice; this only bounds pathological graphs. */
const MAX_EXPOSURE_ROUNDS = 8;

interface WalkBudget {
  files: number;
  skipped: number;
  limit: number;
}

async function* walk(root: string, current: string, budget: WalkBudget): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (budget.files >= budget.limit) return;

    const full = path.join(current, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.github')) continue;
      yield* walk(root, full, budget);
      continue;
    }
    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (!SCANNED_EXTENSIONS.has(extension) && !CONFIG_FILENAMES.test(entry.name)) continue;

    budget.files++;
    yield full;
  }
}

/**
 * Import forms that bind a package into a file, across the ecosystems we support.
 * Subpath imports count: `next/navigation` is still a use of `next`.
 */
function importPatterns(packageName: string): RegExp[] {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // PyPI distribution names differ from module names: `llama-index` -> `llama_index`.
  const moduleName = packageName.replace(/^@[^/]+\//, '').replace(/-/g, '_');
  const escapedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return [
    new RegExp(`\\bfrom\\s+['"\`]${escaped}(?:/[^'"\`]*)?['"\`]`),
    new RegExp(`\\bimport\\s+['"\`]${escaped}(?:/[^'"\`]*)?['"\`]`),
    new RegExp(`\\brequire\\s*\\(\\s*['"\`]${escaped}(?:/[^'"\`]*)?['"\`]`),
    new RegExp(`\\bimport\\s*\\(\\s*['"\`]${escaped}(?:/[^'"\`]*)?['"\`]`),
    new RegExp(`^\\s*import\\s+${escapedModule}\\b`, 'm'),
    new RegExp(`^\\s*from\\s+${escapedModule}(?:\\.[\\w.]+)?\\s+import\\b`, 'm'),
  ];
}

/**
 * A matcher per affected symbol, for the textual path only.
 *
 * Dotted paths and call forms are matched precisely. A bare identifier is matched
 * on a word boundary, which is only safe because these run exclusively against
 * files that import the package.
 */
function symbolPattern(symbol: string): RegExp | null {
  const bare = symbol.replace(/\(\)$/, '');
  if (!/^[A-Za-z_$@][\w$.@/-]*$/.test(bare)) return null;

  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (symbol.endsWith('()')) return new RegExp(`\\b${escaped}\\s*\\(`);
  if (bare.includes('.')) return new RegExp(`\\b${escaped}\\b`);

  // A distinctive identifier (PascalCase, camelCase with a hump, `$`/`_`/`@`
  // prefixed) is safe to match on a word boundary.
  if (/[A-Z]/.test(bare) || /^[_$@]/.test(bare)) return new RegExp(`\\b${escaped}\\b`);

  // A bare lowercase word like `upgrade` or `env` is ordinary English as often as
  // it is an API. Require it to appear in a *usage* position — called, accessed as
  // a member, destructured, or imported — so prose cannot match it.
  return new RegExp(
    `(?:\\b${escaped}\\s*\\()` +
      `|(?:\\.${escaped}\\b)` +
      `|(?:[{,]\\s*${escaped}\\s*[,}:])` +
      `|(?:\\b(?:import|from)\\s+${escaped}\\b)`,
  );
}

/**
 * Blanks out line comments and string literals so symbol matching sees code only.
 *
 * Positions are preserved by substituting spaces, keeping reported columns honest.
 * This is a heuristic, not a parser: it does not track multi-line strings or block
 * comments, which is an acceptable trade for a repository-wide scan.
 */
function codeOnly(line: string): string {
  const blanked = line
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (match) => ' '.repeat(match.length))
    .replace(/\/\/.*$/, (match) => ' '.repeat(match.length))
    .replace(/^\s*[#*].*$/, (match) => ' '.repeat(match.length));

  return blanked;
}

/** ALL_CAPS keys are environment variables; anything else is a config key. */
function isEnvironmentKey(key: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(key);
}

/**
 * What a file re-exports *from the package*, whether directly or through another
 * barrel. `identity` means `export *`, where outward names pass through unchanged.
 */
interface Exposure {
  identity: boolean;
  /** Outward export name -> the package's own export name. */
  named: Map<string, string>;
}

/**
 * Follows re-export edges until the set of package-exposing files stops growing.
 *
 * Without this, a repository that imports everything from `src/lib/index.ts` looks
 * like it never touches the package at all — the common shape in real codebases and
 * the single biggest gap in textual correlation.
 */
function computeExposure(parsed: Map<string, ModuleFacts>, packageName: string): Map<string, Exposure> {
  const exposure = new Map<string, Exposure>();

  const at = (file: string): Exposure => {
    let entry = exposure.get(file);
    if (!entry) {
      entry = { identity: false, named: new Map() };
      exposure.set(file, entry);
    }
    return entry;
  };

  // Seed: files that re-export straight from the package.
  for (const [file, facts] of parsed) {
    for (const group of facts.groups) {
      if (!group.reExport || !specifierMatchesPackage(group.specifier, packageName)) continue;

      const entry = at(file);
      if (group.starReExport) entry.identity = true;
      for (const [outward, source] of group.outward) entry.named.set(outward, source);
    }
  }

  for (let round = 0; round < MAX_EXPOSURE_ROUNDS; round++) {
    let changed = false;

    for (const [file, facts] of parsed) {
      for (const group of facts.groups) {
        if (!group.reExport || !group.resolved) continue;

        const upstream = exposure.get(group.resolved);
        if (!upstream) continue;

        const entry = at(file);

        if (group.starReExport) {
          if (upstream.identity && !entry.identity) {
            entry.identity = true;
            changed = true;
          }
          for (const [outward, source] of upstream.named) {
            if (entry.named.get(outward) === source) continue;
            entry.named.set(outward, source);
            changed = true;
          }
          continue;
        }

        for (const [outward, upstreamName] of group.outward) {
          const source = upstream.named.get(upstreamName) ?? (upstream.identity ? upstreamName : null);
          if (!source || entry.named.get(outward) === source) continue;
          entry.named.set(outward, source);
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  return exposure;
}

/**
 * Rewrites a usage so its `exported` name is the package's own, following one hop
 * through a barrel. Returns null when the usage does not reach the package.
 */
function resolveThroughBarrel(usage: RawUsage, upstream: Exposure): RawUsage | null {
  const lookup = (name: string): string | null =>
    upstream.named.get(name) ?? (upstream.identity ? name : null);

  if (usage.kind === 'named') {
    const source = lookup(usage.exported);
    return source ? { ...usage, exported: source } : null;
  }

  // A whole import of a barrel: the first member is the outward export name.
  if (usage.path.length === 0) return null;
  const source = lookup(usage.path[0]);
  if (!source) return null;

  return { ...usage, kind: 'named', exported: source, path: usage.path.slice(1) };
}

export interface CorrelateOptions {
  /** Cap on files read. Lower it for very large monorepos. */
  maxFiles?: number;
  /**
   * Set false to force textual matching everywhere. Only useful for comparing the
   * two strategies; parsing is strictly more precise where it applies.
   */
  useAst?: boolean;
}

export async function correlateRepository(
  repositoryPath: string,
  packageName: string,
  knowledge: KnowledgeObject[],
  options: CorrelateOptions = {},
): Promise<RepositoryImpact> {
  const root = path.resolve(repositoryPath);

  const impact: RepositoryImpact = {
    package: packageName,
    repository: root,
    usesPackage: false,
    importSites: [],
    symbolSites: [],
    configSites: [],
    environmentSites: [],
    scriptSites: [],
    affectedFiles: [],
    affectedSymbols: [],
    applicableKnowledge: [],
    scanned: { files: 0, skipped: 0, truncated: false, parsed: 0, unparsed: 0 },
  };

  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error(`Not a directory: ${repositoryPath}`);
  }

  const imports = importPatterns(packageName);

  const symbols = [...new Set(knowledge.flatMap((item) => item.affectedApis))];
  const symbolMatchers = symbols
    .map((symbol) => ({ symbol, pattern: symbolPattern(symbol) }))
    .filter((entry): entry is { symbol: string; pattern: RegExp } => entry.pattern !== null);

  // The parsed path matches on resolved names, so it needs the inverse index:
  // normalized name -> the symbol as the changelog wrote it.
  const aliases = packageAliases(packageName);
  const symbolIndex = new Map<string, string>();
  for (const symbol of symbols) {
    const normalized = normalizeSymbol(symbol, aliases);
    if (normalized) symbolIndex.set(normalized, symbol);
  }

  const configKeys = [...new Set(knowledge.flatMap((item) => item.affectedConfig))];

  const fileHitCounts = new Map<string, number>();
  const foundSymbols = new Set<string>();
  const budget: WalkBudget = { files: 0, skipped: 0, limit: options.maxFiles ?? MAX_FILES };

  const ts = options.useAst === false ? null : await loadTypeScript();
  /** Facts per absolute path, for the cross-file pass. */
  const parsedFacts = new Map<string, ModuleFacts>();
  const scannedFiles = new Set<string>();

  const relative = (file: string) => path.relative(root, file) || path.basename(file);

  const record = (bucket: UsageSite[], file: string, line: number, text: string, symbol: string, extra: Partial<UsageSite> = {}) => {
    if (bucket.length >= MAX_SITES_PER_CATEGORY) {
      impact.scanned.truncated = true;
      return;
    }
    const key = relative(file);
    bucket.push({ file: key, line, text: text.trim().slice(0, 240), symbol, ...extra });
    fileHitCounts.set(key, (fileHitCounts.get(key) ?? 0) + 1);
  };

  for await (const file of walk(root, root, budget)) {
    let content: string;
    try {
      const info = await stat(file);
      if (info.size > MAX_FILE_BYTES) {
        budget.skipped++;
        continue;
      }
      content = await readFile(file, 'utf8');
    } catch {
      budget.skipped++;
      continue;
    }

    // Binary files decoded as UTF-8 carry no reviewable usage.
    if (content.indexOf('\u0000') !== -1) {
      budget.skipped++;
      continue;
    }

    scannedFiles.add(file);
    const lines = content.split('\n');

    // Parse first: a successful parse takes over import and symbol detection for
    // this file, and defers its symbol sites to the cross-file pass.
    const facts = ts && isParseableModule(file) ? parseModule(ts, file, content) : null;
    if (facts) {
      parsedFacts.set(file, facts);
      impact.scanned.parsed++;
      if (facts.truncated) impact.scanned.truncated = true;
    } else if (isParseableModule(file)) {
      impact.scanned.unparsed++;
    }

    const fileImportsPackage = imports.some((pattern) => pattern.test(content));
    if (fileImportsPackage) impact.usesPackage = true;

    const basename = path.basename(file).toLowerCase();
    const isPackageJson = basename === 'package.json';

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) continue;

      // Import and symbol sites for parsed files come from the AST instead.
      if (!facts) {
        if (fileImportsPackage && imports.some((pattern) => pattern.test(line))) {
          record(impact.importSites, file, index + 1, line, packageName, { via: 'textual' });
        }

        // Symbol usage is only meaningful where the package is actually imported,
        // and only in code — a symbol named in a comment is documentation, not use.
        if (fileImportsPackage) {
          const code = codeOnly(line);
          for (const { symbol, pattern } of symbolMatchers) {
            if (!pattern.test(code)) continue;
            record(impact.symbolSites, file, index + 1, line, symbol, { via: 'textual' });
            foundSymbols.add(symbol);
          }
        }
      }

      for (const key of configKeys) {
        if (!line.includes(key)) continue;
        record(isEnvironmentKey(key) ? impact.environmentSites : impact.configSites, file, index + 1, line, key);
      }

      // Scripts that invoke the package's CLI break independently of any import.
      if (isPackageJson && line.includes(packageName) && /"[^"]*":\s*"[^"]*"/.test(line)) {
        record(impact.scriptSites, file, index + 1, line, packageName);
      }
    }
  }

  // ---- Cross-file pass over the parsed modules -----------------------------

  for (const [file, facts] of parsedFacts) {
    for (const group of facts.groups) {
      group.resolved = resolveRelative(file, group.specifier, scannedFiles);
    }
  }

  const exposure = computeExposure(parsedFacts, packageName);

  for (const [file, facts] of parsedFacts) {
    /** Group index -> how that group reaches the package, if it does. */
    const reach = new Map<
      number,
      { direct: boolean; upstream?: Exposure; barrel?: string; flush?: () => void }
    >();

    facts.groups.forEach((group, index) => {
      if (specifierMatchesPackage(group.specifier, packageName)) {
        reach.set(index, { direct: true });
        impact.usesPackage = true;
        for (const site of group.sites) {
          record(impact.importSites, file, site.line, site.text, packageName, { via: 'parsed' });
        }
        return;
      }

      const upstream = group.resolved ? exposure.get(group.resolved) : undefined;
      if (!upstream) return;

      const barrel = relative(group.resolved!);

      // A barrel that re-exports the package is not proof this file touches it —
      // the import may take only names the barrel owns. So the import site is held
      // back until a binding is shown to resolve through to the package.
      let flushed = false;
      const flush = () => {
        if (flushed) return;
        flushed = true;
        impact.usesPackage = true;
        for (const site of group.sites) {
          record(impact.importSites, file, site.line, site.text, packageName, {
            via: 'parsed',
            indirect: `re-exported by ${barrel}`,
          });
        }
      };

      reach.set(index, { direct: false, upstream, barrel, flush });
    });

    if (reach.size === 0) continue;

    for (const usage of facts.usages) {
      const route = reach.get(usage.group);
      if (!route) continue;

      const resolved = route.direct ? usage : resolveThroughBarrel(usage, route.upstream!);
      if (!resolved) continue;

      // This binding does reach the package, so the indirect import is real.
      route.flush?.();

      // A computed access resolves to an unknown member; the import itself is
      // already recorded, and inventing a member name here would be a guess.
      if (resolved.dynamic && resolved.path.length === 0 && resolved.kind === 'whole') continue;

      for (const candidate of usageCandidates(resolved, aliases)) {
        const symbol = symbolIndex.get(normalizeSymbol(candidate, aliases));
        if (!symbol) continue;

        const notes: string[] = [];
        if (route.barrel) notes.push(`via ${route.barrel}`);
        if (resolved.dynamic) notes.push('computed access');

        record(impact.symbolSites, file, usage.line, usage.text, symbol, {
          via: 'parsed',
          ...(notes.length > 0 ? { indirect: notes.join(', ') } : {}),
        });
        foundSymbols.add(symbol);
        break;
      }
    }
  }

  impact.scanned.files = budget.files;
  impact.scanned.skipped = budget.skipped;
  if (budget.files >= budget.limit) impact.scanned.truncated = true;

  impact.affectedSymbols = [...foundSymbols];
  impact.affectedFiles = [...fileHitCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file]) => file);

  impact.applicableKnowledge = knowledge
    .filter((item) => item.affectedApis.some((symbol) => foundSymbols.has(symbol)))
    .map((item) => item.id);

  return impact;
}

/**
 * Narrows a knowledge set to what this repository can actually be hit by.
 *
 * Knowledge naming no symbols is retained: a runtime requirement or a changed
 * default affects the repository whether or not it names an API, so dropping it
 * would hide real breakage.
 */
export function applicableKnowledge(knowledge: KnowledgeObject[], impact: RepositoryImpact): KnowledgeObject[] {
  const found = new Set(impact.affectedSymbols);

  return knowledge.filter((item) => {
    if (item.affectedApis.length === 0) return true;
    return item.affectedApis.some((symbol) => found.has(symbol));
  });
}
