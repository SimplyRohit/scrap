/**
 * Manifest ingestion (gen.md section 3).
 *
 * Parses a dependency manifest into `PackageRef[]`. Deliberately does NOT invent
 * a target version — resolving "what should I upgrade to" is the registry's job
 * (`research/registry.ts`), because a guessed target produces confident nonsense
 * downstream.
 */

import type { Ecosystem } from '../knowledge';
import type { PackageRef } from '../request';

export interface ManifestParseResult {
  ecosystem: Ecosystem;
  fileName: string;
  format: 'package.json' | 'requirements.txt' | 'pyproject.toml' | 'unknown';
  packages: PackageRef[];
  totalCount: number;
  warnings: string[];
}

const ECOSYSTEM_PATTERNS: Array<[Ecosystem, RegExp]> = [
  ['langchain', /^(langchain|langgraph|langsmith)(-|$)|^tiktoken$/],
  ['llamaindex', /^llama[-_]index|^(chromadb|pinecone-client|qdrant-client|weaviate-client)$/],
  ['aiml', /^(transformers|torch|torchvision|vllm|diffusers|datasets|accelerate|sentence-transformers|peft|bitsandbytes)$/],
];

const NODE_ONLY = /^(next|react|react-dom|vue|svelte|express|typescript|eslint|tailwindcss|axios|vite|webpack|@[\w-]+\/)/;

export function detectEcosystem(name: string, fallback: Ecosystem): Ecosystem {
  const lower = name.toLowerCase();
  for (const [ecosystem, pattern] of ECOSYSTEM_PATTERNS) {
    if (pattern.test(lower)) return ecosystem;
  }
  if (NODE_ONLY.test(lower)) return 'nodejs';
  return fallback;
}

/** `^6.0.0` / `>=1.2,<2` / `1.10.8` -> a concrete version when one is pinned. */
export function versionFromSpecifier(specifier: string): string | null {
  const match = /(\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?)/.exec(specifier);
  return match ? match[1] : null;
}

function parsePackageJson(content: string, fileName: string): ManifestParseResult {
  const warnings: string[] = [];
  const json = JSON.parse(content) as Record<string, unknown>;
  const packages: PackageRef[] = [];

  const groups: Array<PackageRef['dependencyType']> = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];

  for (const group of groups) {
    const entries = json[group];
    if (!entries || typeof entries !== 'object') continue;

    for (const [name, specifier] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof specifier !== 'string') continue;
      if (specifier.startsWith('workspace:') || specifier.startsWith('file:') || specifier.startsWith('link:')) {
        warnings.push(`${name}: local specifier "${specifier}" skipped — no registry to research`);
        continue;
      }

      const current = versionFromSpecifier(specifier);
      if (!current) {
        warnings.push(`${name}: cannot resolve a concrete version from "${specifier}"`);
        continue;
      }

      packages.push({
        name,
        ecosystem: detectEcosystem(name, 'nodejs'),
        currentVersion: current,
        dependencyType: group,
        specifier,
      });
    }
  }

  return {
    ecosystem: 'nodejs',
    fileName: fileName || 'package.json',
    format: 'package.json',
    packages,
    totalCount: packages.length,
    warnings,
  };
}

const REQUIREMENT_RE = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(.*)$/;

function parseRequirementsTxt(content: string, fileName: string): ManifestParseResult {
  const warnings: string[] = [];
  const packages: PackageRef[] = [];
  let ecosystem: Ecosystem = 'python';

  for (const rawLine of content.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    if (line.startsWith('-')) continue; // -r nested files, -e editable installs, pip flags

    const match = REQUIREMENT_RE.exec(line);
    if (!match) continue;

    const [, name, specifier] = match;
    const current = versionFromSpecifier(specifier);
    if (!current) {
      warnings.push(`${name}: unpinned — cannot determine current version`);
      continue;
    }

    const packageEcosystem = detectEcosystem(name, 'python');
    if (packageEcosystem !== 'python') ecosystem = packageEcosystem;

    packages.push({
      name,
      ecosystem: packageEcosystem,
      currentVersion: current,
      dependencyType: 'dependencies',
      specifier: specifier.trim() || current,
    });
  }

  return {
    ecosystem,
    fileName: fileName || 'requirements.txt',
    format: 'requirements.txt',
    packages,
    totalCount: packages.length,
    warnings,
  };
}

/**
 * Minimal TOML slice: we only read dependency tables, so a full TOML parser
 * would be a dependency bought for four regexes.
 */
function parsePyprojectToml(content: string, fileName: string): ManifestParseResult {
  const warnings: string[] = [];
  const packages: PackageRef[] = [];
  let ecosystem: Ecosystem = 'python';

  const push = (name: string, specifier: string, group: PackageRef['dependencyType']) => {
    if (name.toLowerCase() === 'python') return;
    const current = versionFromSpecifier(specifier);
    if (!current) {
      warnings.push(`${name}: unpinned — cannot determine current version`);
      return;
    }
    const packageEcosystem = detectEcosystem(name, 'python');
    if (packageEcosystem !== 'python') ecosystem = packageEcosystem;
    packages.push({ name, ecosystem: packageEcosystem, currentVersion: current, dependencyType: group, specifier });
  };

  // PEP 621: dependencies = ["fastapi>=0.111", ...]
  const pep621 = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(content);
  if (pep621) {
    for (const entry of pep621[1].split(',')) {
      const cleaned = entry.trim().replace(/^["']|["']$/g, '');
      if (!cleaned) continue;
      const match = REQUIREMENT_RE.exec(cleaned);
      if (match) push(match[1], match[2], 'dependencies');
    }
  }

  // Poetry: [tool.poetry.dependencies] followed by `name = "^1.2.3"` lines.
  const poetry = /\[tool\.poetry\.(dev-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g;
  let section: RegExpExecArray | null;
  while ((section = poetry.exec(content)) !== null) {
    const group: PackageRef['dependencyType'] = section[1] ? 'devDependencies' : 'dependencies';
    for (const line of section[2].split('\n')) {
      const match = /^\s*([A-Za-z0-9._-]+)\s*=\s*(.+)$/.exec(line);
      if (match) push(match[1], match[2], group);
    }
  }

  return {
    ecosystem,
    fileName: fileName || 'pyproject.toml',
    format: 'pyproject.toml',
    packages,
    totalCount: packages.length,
    warnings,
  };
}

export function parseManifest(content: string, fileName = ''): ManifestParseResult {
  const trimmed = content.trim();
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('pyproject.toml') || /^\s*\[(tool\.poetry|project)\]/m.test(trimmed)) {
    return parsePyprojectToml(trimmed, fileName);
  }

  if (trimmed.startsWith('{')) {
    try {
      return parsePackageJson(trimmed, fileName);
    } catch {
      // Malformed JSON falls through to the line parser rather than failing the request.
    }
  }

  return parseRequirementsTxt(trimmed, fileName);
}

/**
 * Lockfile overlay: pins `currentVersion` to what is actually installed rather
 * than what the manifest range allows. `^6.0.0` in package.json with 6.4.2 in the
 * lockfile is a 6.4.2 upgrade problem, not a 6.0.0 one.
 */
export function applyLockfileVersions(
  packages: PackageRef[],
  lockContent: string,
): { packages: PackageRef[]; matched: number } {
  const installed = new Map<string, string>();

  try {
    const lock = JSON.parse(lockContent) as {
      packages?: Record<string, { version?: string }>;
      dependencies?: Record<string, { version?: string }>;
    };
    for (const [key, value] of Object.entries(lock.packages ?? lock.dependencies ?? {})) {
      const name = key.replace(/^node_modules\//, '').replace(/^.*\/node_modules\//, '');
      if (name && value?.version) installed.set(name, value.version);
    }
  } catch {
    // bun.lock / yarn.lock text format: `"pkg@spec": { ... "version": "1.2.3" }`
    const entry = /"?([@\w./-]+)@[^"]*"?\s*:?[\s\S]{0,200}?version"?\s*:?\s*"([\d][^"]*)"/g;
    let match: RegExpExecArray | null;
    while ((match = entry.exec(lockContent)) !== null) {
      if (!installed.has(match[1])) installed.set(match[1], match[2]);
    }
  }

  let matched = 0;
  const updated = packages.map((pkg) => {
    const version = installed.get(pkg.name);
    if (!version) return pkg;
    matched++;
    return { ...pkg, currentVersion: version };
  });

  return { packages: updated, matched };
}
