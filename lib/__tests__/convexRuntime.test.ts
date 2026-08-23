/**
 * The runtime split, enforced.
 *
 * Convex bundles every module under `convex/` for the V8 runtime unless it
 * declares `'use node'`, and a Node built-in reached through five layers of
 * imports fails at push time with an error that names the leaf, not the entry
 * point that pulled it in. That is a slow way to find out, so this walks the
 * same graph the bundler does and fails here instead.
 *
 * The rule: a query, a mutation, or anything they import may not reach
 * `node:*`. Actions may, and say so with the directive.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dir, '..', '..');
const CONVEX = path.join(ROOT, 'convex');

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return entry === '_generated' ? [] : walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

function declaresNode(file: string): boolean {
  return /^\s*(['"])use node\1/m.test(readFileSync(file, 'utf8').slice(0, 200));
}

/** Runtime imports only: `import type` is erased and cannot pull anything in. */
function importsOf(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line) && !/^\s*import\s+type\b/.test(line))
    .map((line) => /from\s+['"]([^'"]+)['"]/.exec(line)?.[1] ?? /^\s*import\s+['"]([^'"]+)['"]/.exec(line)?.[1])
    .filter((specifier): specifier is string => Boolean(specifier));
}

function resolve(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;

  const base = path.resolve(path.dirname(importer), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/** The chain from a Convex-runtime module to a Node built-in, if there is one. */
function nodeReach(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];

  while (stack.length > 0) {
    const { file, chain } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const specifiers = importsOf(file);
    if (specifiers.some((specifier) => specifier.startsWith('node:'))) return chain;

    for (const specifier of specifiers) {
      const next = resolve(file, specifier);
      // A `'use node'` module is its own bundle; the chain stops there.
      if (next && !declaresNode(next)) stack.push({ file: next, chain: [...chain, next] });
    }
  }

  return null;
}

describe('convex runtime boundaries', () => {
  const modules = walk(CONVEX).filter((file) => !declaresNode(file));

  test('there are modules to check', () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  for (const entry of modules) {
    test(`${path.relative(ROOT, entry)} stays in the Convex runtime`, () => {
      const chain = nodeReach(entry);

      expect(chain?.map((file) => path.relative(ROOT, file)).join(' -> ') ?? null).toBeNull();
    });
  }
});
