import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { applicableKnowledge, correlateRepository } from '../analysis/repository';
import type { KnowledgeObject } from '../knowledge';

const temporaries: string[] = [];

async function repositoryWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'upgrade-intel-repo-'));
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

function knowledge(affectedApis: string[], affectedConfig: string[] = []): KnowledgeObject {
  const now = new Date().toISOString();
  return {
    id: `k_${affectedApis.join('_') || 'none'}`,
    type: 'removed_api',
    package: 'demo-pkg',
    ecosystem: 'nodejs',
    title: 'change',
    description: 'change',
    affectedApis,
    affectedConfig,
    migration: [],
    severity: 'HIGH',
    provenance: 'official',
    sources: [],
    confidence: 0.5,
    fingerprint: `fp_${affectedApis.join('_') || 'none'}`,
    embedding: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('import gating', () => {
  test('finds symbols only in files that import the package', async () => {
    // A bare symbol appears in every codebase; counting it everywhere would drown
    // the real findings.
    const root = await repositoryWith({
      'src/uses.ts': "import { createClient } from 'demo-pkg';\nconst c = createClient();\n",
      'src/unrelated.ts': 'function createClient() { return 1; }\nconst c = createClient();\n',
    });

    const impact = await correlateRepository(root, 'demo-pkg', [knowledge(['createClient'])]);

    expect(impact.usesPackage).toBe(true);
    expect(impact.affectedFiles).toContain('src/uses.ts');
    expect(impact.affectedFiles).not.toContain('src/unrelated.ts');
  });

  test('counts subpath imports as use of the package', async () => {
    const root = await repositoryWith({
      'src/a.ts': "import { NextRequest } from 'demo-pkg/server';\nexport const h = (r: NextRequest) => r;\n",
    });

    const impact = await correlateRepository(root, 'demo-pkg', [knowledge(['NextRequest'])]);
    expect(impact.affectedSymbols).toContain('NextRequest');
  });

  test('reports honestly when the package is unused', async () => {
    const root = await repositoryWith({ 'src/a.ts': 'export const x = 1;\n' });

    const impact = await correlateRepository(root, 'demo-pkg', [knowledge(['createClient'])]);
    expect(impact.usesPackage).toBe(false);
    expect(impact.affectedFiles).toEqual([]);
  });
});

describe('match precision', () => {
  test('ignores a generic symbol used as prose', async () => {
    // Regression: `upgrade` matched page metadata text like "before you upgrade".
    const root = await repositoryWith({
      'src/a.ts': "import demo from 'demo-pkg';\nexport const copy = 'Read this before you upgrade today';\n",
    });

    const impact = await correlateRepository(root, 'demo-pkg', [knowledge(['upgrade'])]);
    expect(impact.affectedSymbols).not.toContain('upgrade');
  });

  test('accepts a generic symbol in a usage position', async () => {
    const root = await repositoryWith({
      'src/a.ts': "import demo from 'demo-pkg';\ndemo.upgrade();\n",
    });

    const impact = await correlateRepository(root, 'demo-pkg', [knowledge(['upgrade'])]);
    expect(impact.affectedSymbols).toContain('upgrade');
  });

  test('ignores symbols named only in comments', async () => {
    const root = await repositoryWith({
      'src/a.ts': "import demo from 'demo-pkg';\n// createClient is deprecated, do not use\nexport const x = 1;\n",
    });

    const impact = await correlateRepository(root, 'demo-pkg', [knowledge(['createClient'])]);
    expect(impact.symbolSites).toHaveLength(0);
  });
});

describe('non-code surfaces', () => {
  test('flags environment variables and scripts', async () => {
    const root = await repositoryWith({
      'package.json': JSON.stringify({ scripts: { build: 'demo-pkg build' } }, null, 2),
      'src/env.ts': "import demo from 'demo-pkg';\nconst url = process.env.DEMO_DATABASE_URL;\n",
    });

    const impact = await correlateRepository(root, 'demo-pkg', [knowledge([], ['DEMO_DATABASE_URL'])]);

    expect(impact.environmentSites.map((site) => site.symbol)).toContain('DEMO_DATABASE_URL');
    expect(impact.scriptSites.length).toBeGreaterThan(0);
  });

  test('skips dependency and build directories', async () => {
    const root = await repositoryWith({
      'node_modules/demo-pkg/index.js': "require('demo-pkg');\ncreateClient();\n",
      'src/a.ts': 'export const x = 1;\n',
    });

    const impact = await correlateRepository(root, 'demo-pkg', [knowledge(['createClient'])]);
    expect(impact.affectedFiles).toEqual([]);
    expect(impact.scanned.files).toBe(1);
  });
});

describe('applicableKnowledge', () => {
  test('drops symbol-specific findings the repository cannot hit', async () => {
    const root = await repositoryWith({
      'src/a.ts': "import { used } from 'demo-pkg';\nused();\n",
    });

    const impact = await correlateRepository(root, 'demo-pkg', [knowledge(['used']), knowledge(['neverCalled'])]);
    const applicable = applicableKnowledge([knowledge(['used']), knowledge(['neverCalled'])], impact);

    expect(applicable.map((item) => item.affectedApis[0])).toEqual(['used']);
  });

  test('retains findings that name no symbol', async () => {
    // A runtime requirement or changed default affects you whether or not it
    // names an API; dropping it would hide real breakage.
    const root = await repositoryWith({ 'src/a.ts': "import demo from 'demo-pkg';\n" });

    const impact = await correlateRepository(root, 'demo-pkg', []);
    const applicable = applicableKnowledge([knowledge([])], impact);

    expect(applicable).toHaveLength(1);
  });
});
