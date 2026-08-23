import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { reindexFromCache } from '../index/reindex';
import { JsonKnowledgeStore } from '../index/store';
import { SOURCE_TRUST, type KnowledgeObject, type SourceRef, type SourceType } from '../knowledge';
import { writeCache } from '../research/cache';

const temporaries: string[] = [];
let previousDataDir: string | undefined;

beforeEach(async () => {
  previousDataDir = process.env.UPGRADE_INTEL_DATA_DIR;
  const directory = await mkdtemp(path.join(tmpdir(), 'upgrade-intel-reindex-'));
  temporaries.push(directory);
  process.env.UPGRADE_INTEL_DATA_DIR = directory;
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.UPGRADE_INTEL_DATA_DIR;
  else process.env.UPGRADE_INTEL_DATA_DIR = previousDataDir;
  await Promise.all(temporaries.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function freshStore() {
  return new JsonKnowledgeStore(path.join(temporaries[temporaries.length - 1], 'index.json'));
}

async function cacheDocument(url: string, body: string) {
  await writeCache({
    url,
    status: 200,
    body,
    contentType: 'text/markdown',
    contentHash: 'hash',
    retrievedAt: new Date().toISOString(),
    transport: 'direct',
  });
}

function source(url: string, sourceType: SourceType = 'official_release', extra: Partial<SourceRef> = {}): SourceRef {
  return {
    url,
    domain: 'github.com',
    sourceType,
    trustScore: SOURCE_TRUST[sourceType],
    retrievedAt: new Date().toISOString(),
    contentHash: 'hash',
    title: 'demo 2.0.0 release notes',
    ...extra,
  };
}

function knowledge(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'k_1',
    type: 'security_fix',
    package: 'demo',
    ecosystem: 'nodejs',
    introduced: '2.0.0',
    title: 'Update the security policy document',
    description: 'Update the security policy document',
    affectedApis: [],
    affectedConfig: [],
    migration: [],
    severity: 'HIGH',
    provenance: 'official',
    sources: [source('https://github.com/demo/demo/releases/tag/v2.0.0')],
    confidence: 0.35,
    fingerprint: overrides.fingerprint ?? 'fp_1',
    embedding: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('offline re-extraction', () => {
  test('reclassifies a claim the old rules got wrong', async () => {
    // The point of the pass: type depends on the heading a claim sat under, so
    // it can only be corrected with the original document in hand.
    const store = await freshStore();
    await cacheDocument(
      'https://github.com/demo/demo/releases/tag/v2.0.0',
      '## Chore\n\n- Update the security policy document\n',
    );
    await store.upsert([knowledge()]);

    const result = await reindexFromCache({ store });

    expect(result.documents).toBe(1);
    expect(result.reclassified.some((line) => line.includes('security_fix -> bug_fix'))).toBe(true);
    expect((await store.all()).some((item) => item.type === 'bug_fix')).toBe(true);
  });

  test('keeps what it did not reproduce, unless asked to prune', async () => {
    // Re-extraction is not a guaranteed replay. The claim budget alone can make
    // a large changelog yield fewer claims, and deleting on that basis loses
    // real knowledge to an artefact.
    const store = await freshStore();
    await cacheDocument('https://github.com/demo/demo/releases/tag/v2.0.0', '## Chore\n\n- Something else entirely\n');
    await store.upsert([knowledge()]);

    const held = await reindexFromCache({ store });

    expect(held.removed).toHaveLength(1);
    expect(held.removalsHeld).toBe(true);
    expect(await store.get('k_1')).not.toBeNull();

    const pruned = await reindexFromCache({ store, pruneMissing: true });

    expect(pruned.removalsHeld).toBe(false);
    expect(await store.get('k_1')).toBeNull();
  });

  test('a dry run writes nothing', async () => {
    const store = await freshStore();
    await cacheDocument(
      'https://github.com/demo/demo/releases/tag/v2.0.0',
      '## Chore\n\n- Update the security policy document\n',
    );
    await store.upsert([knowledge()]);

    await reindexFromCache({ store, dryRun: true });

    expect((await store.all()).every((item) => item.type === 'security_fix')).toBe(true);
  });

  test('reads the document from where it was actually retrieved', async () => {
    // Release notes are cited as the release page and read from the API. Looking
    // only at the citation URL found nothing in the cache and the whole pass
    // reported every document missing.
    const store = await freshStore();
    await cacheDocument(
      'https://api.github.com/repos/demo/demo/releases/tags/v2.0.0',
      '## Chore\n\n- Update the security policy document\n',
    );
    await store.upsert([
      knowledge({
        sources: [
          source('https://github.com/demo/demo/releases/tag/v2.0.0', 'official_release', {
            retrievalUrl: 'https://api.github.com/repos/demo/demo/releases/tags/v2.0.0',
          }),
        ],
      }),
    ]);

    const result = await reindexFromCache({ store });

    expect(result.documents).toBe(1);
    expect(result.missing).toBe(0);
  });

  test('counts a document that is no longer cached instead of dropping its knowledge', async () => {
    const store = await freshStore();
    await store.upsert([knowledge()]);

    const result = await reindexFromCache({ store });

    expect(result.missing).toBe(1);
    expect(result.removed).toEqual([]);
    expect(await store.get('k_1')).not.toBeNull();
  });

  test('leaves issue-derived and verified knowledge alone', async () => {
    // Neither came from a document. Their cache entries are API JSON and
    // nothing at all, so re-extracting would replace real knowledge with noise.
    const store = await freshStore();
    await store.upsert([
      knowledge({ id: 'k_issue', fingerprint: 'fp_i', type: 'github_issue', sources: [source('https://github.com/demo/demo/issues/1', 'official_issue')] }),
      knowledge({ id: 'k_fix', fingerprint: 'fp_v', type: 'error_solution', sources: [source('upgrade-intel://verified-fix/abc', 'verified_fix')] }),
    ]);

    const result = await reindexFromCache({ store });

    expect(result.documents).toBe(0);
    expect(result.missing).toBe(0);
    expect(await store.get('k_issue')).not.toBeNull();
    expect(await store.get('k_fix')).not.toBeNull();
  });

  test('scopes to one package when asked', async () => {
    const store = await freshStore();
    await cacheDocument('https://github.com/other/other/releases/tag/v1.0.0', '## Chore\n\n- Something\n');
    await store.upsert([
      knowledge({ id: 'k_other', fingerprint: 'fp_o', package: 'other', sources: [source('https://github.com/other/other/releases/tag/v1.0.0')] }),
    ]);

    const result = await reindexFromCache({ store, package: 'demo' });

    expect(result.documents).toBe(0);
  });
});
