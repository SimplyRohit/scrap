/**
 * Repository correlation (gen.md section 14).
 *
 * "This API changed" is not actionable. This module answers the question that is:
 * does *your* repository use it, and where.
 *
 * The controlling idea is that import sites gate symbol sites. A bare symbol like
 * `render` or `parse` appears in every codebase; counting it as impact would drown
 * the real findings. So a file only contributes symbol matches once it is shown to
 * import the package under investigation.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { KnowledgeObject } from '../knowledge';

export interface UsageSite {
  /** Repository-relative path. */
  file: string;
  line: number;
  /** The matched source line, trimmed and truncated. */
  text: string;
  symbol: string;
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
  scanned: { files: number; skipped: number; truncated: boolean };
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
 * A matcher per affected symbol.
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

function site(file: string, root: string, lineIndex: number, line: string, symbol: string): UsageSite {
  return {
    file: path.relative(root, file) || path.basename(file),
    line: lineIndex + 1,
    text: line.trim().slice(0, 240),
    symbol,
  };
}

/** ALL_CAPS keys are environment variables; anything else is a config key. */
function isEnvironmentKey(key: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(key);
}

export interface CorrelateOptions {
  /** Cap on files read. Lower it for very large monorepos. */
  maxFiles?: number;
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
    scanned: { files: 0, skipped: 0, truncated: false },
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

  const configKeys = [...new Set(knowledge.flatMap((item) => item.affectedConfig))];

  const fileHitCounts = new Map<string, number>();
  const foundSymbols = new Set<string>();
  const budget: WalkBudget = { files: 0, skipped: 0, limit: options.maxFiles ?? MAX_FILES };

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

    const lines = content.split('\n');
    const fileImportsPackage = imports.some((pattern) => pattern.test(content));
    if (fileImportsPackage) impact.usesPackage = true;

    const record = (bucket: UsageSite[], lineIndex: number, symbol: string) => {
      if (bucket.length >= MAX_SITES_PER_CATEGORY) {
        impact.scanned.truncated = true;
        return;
      }
      bucket.push(site(file, root, lineIndex, lines[lineIndex], symbol));
      const key = path.relative(root, file);
      fileHitCounts.set(key, (fileHitCounts.get(key) ?? 0) + 1);
    };

    const basename = path.basename(file).toLowerCase();
    const isPackageJson = basename === 'package.json';

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) continue;

      if (fileImportsPackage && imports.some((pattern) => pattern.test(line))) {
        record(impact.importSites, index, packageName);
      }

      // Symbol usage is only meaningful where the package is actually imported,
      // and only in code — a symbol named in a comment is documentation, not use.
      if (fileImportsPackage) {
        const code = codeOnly(line);
        for (const { symbol, pattern } of symbolMatchers) {
          if (!pattern.test(code)) continue;
          record(impact.symbolSites, index, symbol);
          foundSymbols.add(symbol);
        }
      }

      for (const key of configKeys) {
        if (!line.includes(key)) continue;
        record(isEnvironmentKey(key) ? impact.environmentSites : impact.configSites, index, key);
      }

      // Scripts that invoke the package's CLI break independently of any import.
      if (isPackageJson && line.includes(packageName) && /"[^"]*":\s*"[^"]*"/.test(line)) {
        record(impact.scriptSites, index, packageName);
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
