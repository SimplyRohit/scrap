import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  loadTypeScript,
  normalizeSymbol,
  packageAliases,
  parseModule,
  resolveRelative,
  setTypeScriptForTesting,
  specifierMatchesPackage,
  usageCandidates,
  type ModuleFacts,
  type RawUsage,
} from '../analysis/ast';
import { correlateRepository } from '../analysis/repository';
import type { KnowledgeObject } from '../knowledge';

type Ts = NonNullable<Awaited<ReturnType<typeof loadTypeScript>>>;

let ts: Ts;

beforeAll(async () => {
  const loaded = await loadTypeScript();
  if (!loaded) throw new Error('typescript is required for these tests');
  ts = loaded;
});

function parse(source: string, file = '/repo/src/a.ts'): ModuleFacts {
  const facts = parseModule(ts, file, source);
  if (!facts) throw new Error('expected the module to parse');
  return facts;
}

/** The usages that came from a `demo` import, with their resolved export names. */
function demoUsages(facts: ModuleFacts): RawUsage[] {
  return facts.usages.filter((usage) => facts.groups[usage.group].specifier === 'demo');
}

describe('binding resolution', () => {
  test('records a renamed import under the name the package exports', () => {
    // The whole point of parsing: `r()` is a use of `legacy`, and no amount of
    // pattern matching on the call site can know that.
    const facts = parse("import { legacy as r } from 'demo';\nexport const run = () => r();\n");
    const [usage] = demoUsages(facts);

    expect(usage.exported).toBe('legacy');
    expect(usage.kind).toBe('named');
    expect(usage.called).toBe(true);
    expect(usage.line).toBe(2);
  });

  test('reads the member path off a namespace import', () => {
    const facts = parse("import * as ns from 'demo';\nexport const go = () => ns.a.b();\n");
    const [usage] = demoUsages(facts);

    expect(usage.kind).toBe('whole');
    expect(usage.path).toEqual(['a', 'b']);
    expect(usage.called).toBe(true);
  });

  test('resolves a renamed require destructure', () => {
    const facts = parse("const { legacy: l } = require('demo');\nmodule.exports = () => l();\n", '/repo/src/a.js');
    const [usage] = demoUsages(facts);

    expect(usage.exported).toBe('legacy');
    expect(usage.called).toBe(true);
  });

  test('treats an awaited dynamic import as a binding', () => {
    const facts = parse("export async function f() {\n  const { legacy } = await import('demo');\n  return legacy();\n}\n");

    expect(demoUsages(facts).map((usage) => usage.exported)).toContain('legacy');
  });

  test('counts a re-export as a use of the re-exported name', () => {
    // `export { legacy } from 'demo'` breaks when `legacy` is removed, even though
    // nothing in the file calls it.
    const facts = parse("export { legacy as oldLegacy } from 'demo';\n");
    const [usage] = demoUsages(facts);

    expect(usage.exported).toBe('legacy');
    expect(facts.groups[0].reExport).toBe(true);
    expect([...facts.groups[0].outward]).toEqual([['oldLegacy', 'legacy']]);
  });

  test('marks `export *` so the whole namespace is known to pass through', () => {
    const facts = parse("export * from 'demo';\n");

    expect(facts.groups[0].starReExport).toBe(true);
    expect(facts.groups[0].reExport).toBe(true);
  });

  test('records a type-position reference', () => {
    // A removed type breaks the build as surely as a removed function.
    const facts = parse("import type { Config } from 'demo';\nexport const c: Config = {};\n");

    expect(demoUsages(facts).map((usage) => usage.exported)).toContain('Config');
  });

  test('does not mistake a property of the same name for the import', () => {
    const facts = parse("import { legacy } from 'demo';\nexport const o = { legacy: 1 };\nexport const p = other.legacy;\n");

    // Only the object key and the unrelated member access appear, neither of which
    // reads the binding — so there is nothing to report.
    expect(demoUsages(facts)).toHaveLength(0);
  });
});

describe('ambiguity', () => {
  test('flags a computed access instead of guessing the member', () => {
    const facts = parse("import * as ns from 'demo';\nexport const q = (k: string) => ns[k];\n");
    const [usage] = demoUsages(facts);

    expect(usage.dynamic).toBe(true);
    expect(usage.path).toEqual([]);
  });

  test('resolves a computed access written as a string literal', () => {
    const facts = parse("import * as ns from 'demo';\nexport const q = () => ns['legacy']();\n");
    const [usage] = demoUsages(facts);

    expect(usage.dynamic).toBe(false);
    expect(usage.path).toEqual(['legacy']);
  });

  test('drops a binding shadowed by a local declaration', () => {
    // Keeping it would invent a finding; dropping it loses one. Inventing is worse.
    const facts = parse("import { legacy } from 'demo';\nfunction legacy() {\n  return 1;\n}\nexport const x = legacy();\n");

    expect(demoUsages(facts)).toHaveLength(0);
  });

  test('returns null for a file that does not parse', () => {
    // A partial tree silently loses bindings, so the caller must fall back to
    // textual matching rather than trust half an answer.
    expect(parseModule(ts, '/repo/src/broken.ts', 'import { a from "demo"\nfunction (')).toBeNull();
  });
});

describe('candidate names', () => {
  const usage = (overrides: Partial<RawUsage>): RawUsage => ({
    group: 0,
    exported: 'legacy',
    kind: 'named',
    path: [],
    called: true,
    dynamic: false,
    line: 1,
    text: '',
    ...overrides,
  });

  test('offers a named export bare and package-qualified', () => {
    const candidates = usageCandidates(usage({}), packageAliases('demo'));

    expect(candidates).toContain('legacy');
    expect(candidates).toContain('demo.legacy');
  });

  test('offers a whole-module member under the package name', () => {
    // Maintainers write `axios.create()`, never `<your local name>.create()`.
    const candidates = usageCandidates(usage({ kind: 'whole', exported: '*', path: ['create'] }), packageAliases('axios'));

    expect(candidates).toContain('create');
    expect(candidates).toContain('axios.create');
  });

  test('offers the module itself when it is called directly', () => {
    const candidates = usageCandidates(usage({ kind: 'whole', exported: 'default', path: [] }), packageAliases('axios'));

    expect(candidates).toContain('axios');
  });

  test('aliases cover scopes and the Python module spelling', () => {
    expect(packageAliases('@scope/date-fns')).toContain('date-fns');
    expect(packageAliases('@scope/date-fns')).toContain('date_fns');
    expect(packageAliases('@scope/date-fns')).toContain('dateFns');
  });

  test('normalizes a symbol as a changelog writes it', () => {
    const aliases = packageAliases('axios');

    expect(normalizeSymbol('`axios.create()`', aliases)).toBe('axios.create');
    // Sources capitalise the package name inconsistently; the API name never is.
    expect(normalizeSymbol('Axios.create()', aliases)).toBe('axios.create');
    expect(normalizeSymbol('createClient', aliases)).toBe('createClient');
  });
});

describe('specifier handling', () => {
  test('matches subpaths and the Python module form', () => {
    expect(specifierMatchesPackage('next/navigation', 'next')).toBe(true);
    expect(specifierMatchesPackage('llama_index.core', 'llama-index')).toBe(true);
    expect(specifierMatchesPackage('nextcloud', 'next')).toBe(false);
  });

  test('resolves relative specifiers against the scanned set', () => {
    const known = new Set(['/repo/src/lib/index.ts', '/repo/src/util.ts']);

    expect(resolveRelative('/repo/src/a.ts', './lib', known)).toBe('/repo/src/lib/index.ts');
    expect(resolveRelative('/repo/src/a.ts', './util', known)).toBe('/repo/src/util.ts');
    // An ESM `.js` specifier points at the TypeScript source it compiles from.
    expect(resolveRelative('/repo/src/a.ts', './util.js', known)).toBe('/repo/src/util.ts');
    expect(resolveRelative('/repo/src/a.ts', 'demo', known)).toBeNull();
  });
});

// ---- Correlation through the real filesystem -------------------------------

const temporaries: string[] = [];

async function repositoryWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'upgrade-intel-ast-'));
  temporaries.push(root);

  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function knowledge(affectedApis: string[]): KnowledgeObject {
  const now = new Date().toISOString();
  return {
    id: `k_${affectedApis.join('_')}`,
    type: 'removed_api',
    package: 'demo',
    ecosystem: 'nodejs',
    title: 'change',
    description: 'change',
    affectedApis,
    affectedConfig: [],
    migration: [],
    severity: 'HIGH',
    provenance: 'official',
    sources: [],
    confidence: 0.5,
    fingerprint: `fp_${affectedApis.join('_')}`,
    embedding: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('correlation through the module graph', () => {
  test('follows a barrel that re-exports the package under a new name', async () => {
    // The shape that defeats textual correlation completely: nothing in
    // `consumer.ts` mentions `demo` or `legacy`.
    const root = await repositoryWith({
      'src/lib/barrel.ts': "export { legacy as oldLegacy } from 'demo';\n",
      'src/consumer.ts': "import { oldLegacy } from './lib/barrel';\nexport const call = () => oldLegacy();\n",
    });

    const impact = await correlateRepository(root, 'demo', [knowledge(['legacy()'])]);

    expect(impact.affectedSymbols).toContain('legacy()');
    expect(impact.affectedFiles).toContain('src/consumer.ts');

    const site = impact.symbolSites.find((entry) => entry.file === 'src/consumer.ts');
    expect(site?.via).toBe('parsed');
    // The indirection is disclosed rather than presented as a direct use.
    expect(site?.indirect).toContain('barrel');
  });

  test('follows an `export *` chain two hops deep', async () => {
    const root = await repositoryWith({
      'src/lib/inner.ts': "export * from 'demo';\n",
      'src/lib/outer.ts': "export * from './inner';\n",
      'src/consumer.ts': "import { legacy } from './lib/outer';\nexport const call = () => legacy();\n",
    });

    const impact = await correlateRepository(root, 'demo', [knowledge(['legacy()'])]);
    expect(impact.affectedFiles).toContain('src/consumer.ts');
  });

  test('does not report a barrel export the package never provided', async () => {
    const root = await repositoryWith({
      'src/lib/barrel.ts': "export { legacy } from 'demo';\nexport { ours } from './ours';\n",
      'src/ours.ts': 'export const ours = () => 1;\n',
      'src/consumer.ts': "import { ours } from './lib/barrel';\nexport const call = () => ours();\n",
    });

    const impact = await correlateRepository(root, 'demo', [knowledge(['ours()'])]);
    expect(impact.affectedFiles).not.toContain('src/consumer.ts');
  });

  test('resolves a renamed import at its call site', async () => {
    const root = await repositoryWith({
      'src/a.ts': "import { legacy as r } from 'demo';\nexport const run = () => r();\n",
    });

    const impact = await correlateRepository(root, 'demo', [knowledge(['legacy()'])]);

    expect(impact.affectedSymbols).toContain('legacy()');
    expect(impact.symbolSites[0].via).toBe('parsed');
  });

  test('matches a package-qualified symbol against a namespace member', async () => {
    const root = await repositoryWith({
      'src/a.ts': "import * as client from 'demo';\nexport const run = () => client.create();\n",
    });

    const impact = await correlateRepository(root, 'demo', [knowledge(['demo.create()'])]);
    expect(impact.affectedSymbols).toContain('demo.create()');
  });

  test('reports the import but no symbol for a computed access', async () => {
    const root = await repositoryWith({
      'src/a.ts': "import * as ns from 'demo';\nexport const q = (k: string) => ns[k];\n",
    });

    const impact = await correlateRepository(root, 'demo', [knowledge(['legacy()'])]);

    expect(impact.usesPackage).toBe(true);
    expect(impact.symbolSites).toHaveLength(0);
  });

  test('counts parsed and unparsed files separately', async () => {
    const root = await repositoryWith({
      'src/a.ts': "import { legacy } from 'demo';\nexport const x = legacy();\n",
      'src/b.py': 'from demo import legacy\n\nlegacy()\n',
    });

    const impact = await correlateRepository(root, 'demo', [knowledge(['legacy()'])]);

    expect(impact.scanned.parsed).toBe(1);
    // Python has no parser here, so it is neither parsed nor counted as a failure.
    expect(impact.scanned.unparsed).toBe(0);
    expect(impact.symbolSites.map((site) => site.via)).toContain('textual');
  });
});

describe('degraded operation', () => {
  afterAll(() => {
    // Undefined, not null: the next caller re-loads rather than inheriting a stub.
    setTypeScriptForTesting(undefined);
  });

  test('falls back to textual matching when the parser is unavailable', async () => {
    // `typescript` is a devDependency, so a deployed runtime may not have it. The
    // answer must degrade, not disappear.
    const root = await repositoryWith({
      'src/a.ts': "import { legacy } from 'demo';\nexport const x = legacy();\n",
    });

    setTypeScriptForTesting(null);
    const impact = await correlateRepository(root, 'demo', [knowledge(['legacy()'])]);

    expect(impact.usesPackage).toBe(true);
    expect(impact.affectedSymbols).toContain('legacy()');
    expect(impact.symbolSites.every((site) => site.via === 'textual')).toBe(true);
    expect(impact.scanned.parsed).toBe(0);
  });

  test('a renamed import is what the textual path loses', async () => {
    // Stated as a test so the gap is documented rather than assumed.
    const root = await repositoryWith({
      'src/a.ts': "import { legacy as r } from 'demo';\nexport const run = () => r();\n",
    });

    setTypeScriptForTesting(null);
    const withoutParser = await correlateRepository(root, 'demo', [knowledge(['legacy()'])]);
    expect(withoutParser.affectedSymbols).not.toContain('legacy()');

    setTypeScriptForTesting(undefined);
    const withParser = await correlateRepository(root, 'demo', [knowledge(['legacy()'])]);
    expect(withParser.affectedSymbols).toContain('legacy()');
  });
});
