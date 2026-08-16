import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Integration tests for the orchestration layer.
 *
 * These stub `globalThis.fetch` rather than the engine's own modules, so the real
 * cache, transport selection, registry parsing, and release-window logic all run.
 * The response *shapes* below were taken from the live npm and GitHub APIs during
 * development — the point is to pin down orchestration decisions (budget
 * accounting, index-first short-circuiting, fallbacks), not to re-test parsing.
 *
 * `paths.ts` reads its data directory at module load, so every import here is
 * dynamic and happens after the environment is set.
 */

const realFetch = globalThis.fetch;
let dataDirectory: string;

type Route = (url: string) => Response | null;

let routes: Route[] = [];
const requested: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function markdown(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/markdown' } });
}

beforeAll(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'upgrade-intel-pipeline-'));
  process.env.UPGRADE_INTEL_DATA_DIR = dataDirectory;
  // Keep the unlocker and SERP out of these tests; they are transport concerns.
  delete process.env.BRIGHTDATA_API_KEY;
  delete process.env.BRIGHTDATA_SERP_ZONE;
  delete process.env.GITHUB_TOKEN;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await rm(dataDirectory, { recursive: true, force: true });
});

beforeEach(() => {
  requested.length = 0;
  routes = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requested.push(url);

    for (const route of routes) {
      const response = route(url);
      if (response) return response;
    }
    // Anything unrouted is a dead end, which is what a speculative URL looks like.
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

afterEach(async () => {
  // Each test starts from a cold cache so budget accounting is observable.
  await rm(path.join(dataDirectory, 'cache'), { recursive: true, force: true });
});

const PACKUMENT = {
  'dist-tags': { latest: '2.0.0' },
  versions: { '1.0.0': {}, '1.5.0': {}, '2.0.0': {} },
  repository: { url: 'https://github.com/demo/demo' },
  homepage: 'https://demo.example.com',
  description: 'demo',
};

const RELEASE_BODY = [
  '### Removed',
  '',
  '- `legacyClient()` has been removed',
  '',
  '### Bug Fixes',
  '',
  '- fix(core): tidy internals',
].join('\n');

function routeRegistry(): Route {
  return (url) => (url.startsWith('https://registry.npmjs.org/demo') ? json(PACKUMENT) : null);
}

/** The releases list, with `include` controlling which versions it contains. */
function routeReleaseList(versions: string[]): Route {
  return (url) =>
    url.startsWith('https://api.github.com/repos/demo/demo/releases?')
      ? json(
          versions.map((version) => ({
            tag_name: `v${version}`,
            name: `v${version}`,
            body: RELEASE_BODY,
            published_at: '2026-01-01T00:00:00Z',
            html_url: `https://github.com/demo/demo/releases/tag/v${version}`,
            prerelease: false,
            draft: false,
          })),
        )
      : null;
}

function routeTaggedRelease(version: string): Route {
  return (url) =>
    url === `https://api.github.com/repos/demo/demo/releases/tags/v${version}`
      ? json({
          tag_name: `v${version}`,
          name: `v${version}`,
          body: RELEASE_BODY,
          published_at: '2026-01-01T00:00:00Z',
          html_url: `https://github.com/demo/demo/releases/tag/v${version}`,
          prerelease: false,
          draft: false,
        })
      : null;
}

function routeChangelog(): Route {
  return (url) =>
    url.includes('CHANGELOG.md') ? markdown('## 2.0.0\n\n### Removed\n\n- `legacyClient()` has been removed') : null;
}

async function pipeline() {
  return import('../pipeline');
}

async function freshStore() {
  const { JsonKnowledgeStore } = await import('../index/store');
  return new JsonKnowledgeStore(path.join(dataDirectory, `index-${Math.random().toString(36).slice(2)}.json`));
}

const ref = {
  name: 'demo',
  ecosystem: 'nodejs' as const,
  currentVersion: '1.0.0',
  dependencyType: 'dependencies' as const,
  specifier: '1.0.0',
};

describe('researchPackageUpgrade', () => {
  test('resolves the target from the registry and indexes what it extracts', async () => {
    routes = [routeRegistry(), routeReleaseList(['1.5.0', '2.0.0'])];

    const { researchPackageUpgrade } = await pipeline();
    const store = await freshStore();
    const result = await researchPackageUpgrade(ref, { store, maxDocuments: 3 });

    expect(result.change.toVersion).toBe('2.0.0');
    expect(result.change.delta).toBe('major');
    expect(result.knowledge.some((item) => item.type === 'removed_api')).toBe(true);
    // Everything extracted is persisted, not just returned.
    expect((await store.all()).length).toBe(result.knowledge.length);
  });

  test('reports honestly when the registry has nothing newer', async () => {
    routes = [routeRegistry()];

    const { researchPackageUpgrade } = await pipeline();
    const store = await freshStore();
    const result = await researchPackageUpgrade(
      { ...ref, currentVersion: '2.0.0' },
      { store },
    );

    expect(result.change.toVersion).toBeNull();
    expect(result.warnings.join(' ')).toContain('no newer version');
  });

  test('warns rather than implying safety when sources yield nothing', async () => {
    // "No breaking changes found" must never read as "safe to upgrade".
    routes = [routeRegistry(), routeReleaseList([])];

    const { researchPackageUpgrade } = await pipeline();
    const store = await freshStore();
    const result = await researchPackageUpgrade(ref, { store, maxDocuments: 2, allowSearch: false });

    if (result.trace.fetched.length > 0 && result.knowledge.length === 0) {
      expect(result.warnings.join(' ')).toContain('unverified');
    }
    expect(result.risk.rationale.join(' ')).toContain('semver permits breaking changes');
  });
});

describe('release selection', () => {
  test('fetches the target tag directly when the release list misses it', async () => {
    // High-frequency publishers push the target past the pages we list; without
    // this the most relevant release is never read.
    routes = [routeRegistry(), routeReleaseList(['1.5.0']), routeTaggedRelease('2.0.0')];

    const { researchPackageUpgrade } = await pipeline();
    const store = await freshStore();
    await researchPackageUpgrade(ref, { store, maxDocuments: 3 });

    expect(requested).toContain('https://api.github.com/repos/demo/demo/releases/tags/v2.0.0');
  });
});

describe('document budget', () => {
  test('speculative dead ends do not starve productive sources', async () => {
    // Regression: conventional doc URLs (/docs/migration, /docs/upgrade) consumed
    // the whole budget with zero extractions, so release notes were never read.
    routes = [routeRegistry(), routeReleaseList([]), routeChangelog()];

    const { researchPackageUpgrade } = await pipeline();
    const store = await freshStore();
    const result = await researchPackageUpgrade(ref, { store, maxDocuments: 2, allowSearch: false });

    const productive = result.trace.fetched.filter((source) => source.extracted > 0);
    expect(productive.length).toBeGreaterThan(0);
    expect(result.knowledge.some((item) => item.type === 'removed_api')).toBe(true);
  });

  test('bounds total attempts even when everything fails', async () => {
    routes = [routeRegistry(), routeReleaseList([])];

    const { researchPackageUpgrade } = await pipeline();
    const store = await freshStore();
    const result = await researchPackageUpgrade(ref, { store, maxDocuments: 2, allowSearch: false });

    // maxDocuments * 3, plus the registry and release-list calls.
    expect(result.trace.fetched.length).toBeLessThanOrEqual(6);
  });
});

describe('incremental indexing', () => {
  test('serves a covered upgrade from the index without fetching', async () => {
    routes = [routeRegistry(), routeReleaseList(['2.0.0'])];

    const { researchPackageUpgrade } = await pipeline();
    const store = await freshStore();
    await researchPackageUpgrade(ref, { store, maxDocuments: 2 });

    requested.length = 0;
    const second = await researchPackageUpgrade(ref, { store, maxDocuments: 2 });

    expect(second.trace.servedFromIndex).toBe(true);
    expect(second.knowledge.length).toBeGreaterThan(0);
    // Only the registry lookup, to resolve the target version.
    expect(requested.every((url) => url.startsWith('https://registry.npmjs.org/'))).toBe(true);
  });

  test('refresh bypasses index coverage', async () => {
    routes = [routeRegistry(), routeReleaseList(['2.0.0'])];

    const { researchPackageUpgrade } = await pipeline();
    const store = await freshStore();
    await researchPackageUpgrade(ref, { store, maxDocuments: 2 });

    const second = await researchPackageUpgrade(ref, { store, maxDocuments: 2, refresh: true });
    expect(second.trace.servedFromIndex).toBe(false);
  });
});

describe('researchManifest', () => {
  test('researches every package and aggregates safety', async () => {
    routes = [routeRegistry(), routeReleaseList(['2.0.0'])];

    const { researchManifest } = await pipeline();
    const store = await freshStore();

    const result = await researchManifest(
      {
        ecosystem: 'nodejs',
        fileName: 'package.json',
        format: 'package.json',
        packages: [ref],
        totalCount: 1,
        warnings: [],
      },
      { store, maxDocuments: 2 },
    );

    expect(result.results).toHaveLength(1);
    expect(result.totalKnowledge).toBeGreaterThan(0);
    expect(result.overallSafety).toBeTruthy();
  });
});

describe('resolveError', () => {
  test('answers from the index without touching the network', async () => {
    routes = [routeRegistry(), routeReleaseList(['2.0.0'])];

    const { researchPackageUpgrade } = await pipeline();
    const { resolveError } = await import('../errorPipeline');
    const store = await freshStore();
    await researchPackageUpgrade(ref, { store, maxDocuments: 2 });

    requested.length = 0;
    const resolution = await resolveError({
      package: 'demo',
      version: '2.0.0',
      error: 'TypeError: legacyClient is not a function',
      indexOnly: true,
      store,
    });

    expect(requested).toHaveLength(0);
    expect(resolution.trace.indexHits).toBeGreaterThan(0);
    expect(resolution.evidence.length).toBeGreaterThan(0);
  });

  test('produces a fingerprint and a caveat even with no matching knowledge', async () => {
    const { resolveError } = await import('../errorPipeline');
    const store = await freshStore();

    const resolution = await resolveError({
      package: 'demo',
      version: '2.0.0',
      error: 'TypeError: something entirely unrelated',
      indexOnly: true,
      store,
    });

    expect(resolution.fingerprint.errorType).toBe('TypeError');
    expect(resolution.evidence).toHaveLength(0);
    expect(resolution.caveat).toContain('no authoritative source');
    expect(resolution.diagnosis).toContain('No indexed knowledge');
  });

  test('excludes knowledge scoped to a different version', async () => {
    routes = [routeRegistry(), routeReleaseList(['2.0.0'])];

    const { researchPackageUpgrade } = await pipeline();
    const { resolveError } = await import('../errorPipeline');
    const store = await freshStore();
    await researchPackageUpgrade(ref, { store, maxDocuments: 2 });

    const resolution = await resolveError({
      package: 'demo',
      version: '1.0.0', // predates everything indexed
      error: 'TypeError: legacyClient is not a function',
      indexOnly: true,
      store,
    });

    expect(resolution.evidence.every((item) => item.appliesToVersion)).toBe(true);
  });
});
