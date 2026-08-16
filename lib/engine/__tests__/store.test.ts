import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { deduplicate } from '../analysis/dedupe';
import { JsonKnowledgeStore } from '../index/store';
import { SOURCE_TRUST, type KnowledgeObject, type SourceType } from '../knowledge';

const temporaries: string[] = [];

async function freshStore() {
  const directory = await mkdtemp(path.join(tmpdir(), 'upgrade-intel-test-'));
  temporaries.push(directory);
  return new JsonKnowledgeStore(path.join(directory, 'index.json'));
}

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function knowledge(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  const sourceType: SourceType = overrides.sources?.[0]?.sourceType ?? 'official_changelog';
  const now = new Date().toISOString();

  return {
    id: overrides.id ?? `k_${Math.random().toString(36).slice(2, 10)}`,
    type: 'removed_api',
    package: 'demo',
    ecosystem: 'nodejs',
    title: 'foo() was removed',
    description: '`foo()` was removed in this release',
    affectedApis: ['foo()'],
    affectedConfig: [],
    migration: [],
    severity: 'CRITICAL',
    provenance: 'official',
    sources: [
      {
        url: 'https://example.com/changelog',
        domain: 'example.com',
        sourceType,
        trustScore: SOURCE_TRUST[sourceType],
        retrievedAt: now,
        contentHash: 'hash',
      },
    ],
    confidence: 0.5,
    fingerprint: 'fp-foo',
    embedding: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('version filtering', () => {
  test('excludes knowledge scoped to a different range', async () => {
    // The bug this prevents: "Prisma 5 error" answering a "Prisma 7" question.
    const store = await freshStore();
    await store.upsert([
      knowledge({ id: 'k_new', fingerprint: 'fp-new', affected: '>=16.0.0' }),
      knowledge({ id: 'k_old', fingerprint: 'fp-old', affected: '>=15.0.0 <16.0.0' }),
    ]);

    const results = await store.search({ package: 'demo', version: '15.2.0', text: 'foo removed' });
    expect(results.map((result) => result.knowledge.id)).toEqual(['k_old']);
  });

  test('keeps unversioned knowledge eligible', async () => {
    const store = await freshStore();
    await store.upsert([knowledge({ id: 'k_any', affected: undefined, introduced: undefined })]);

    const results = await store.search({ package: 'demo', version: '99.0.0', text: 'foo' });
    expect(results).toHaveLength(1);
  });
});

describe('ranking', () => {
  test('ignores a generic error type rather than matching every document', async () => {
    // `Error: params should be awaited` has type `Error`; awarding the exact-match
    // bonus for that would boost anything containing the word.
    const store = await freshStore();
    await store.upsert([knowledge({ id: 'k_a', description: 'an error occurred while parsing' })]);

    const [result] = await store.search({ package: 'demo', text: 'parsing', errorType: 'Error' });
    expect(result.signals.exactErrorMatch).toBe(0);
  });

  test('honours a distinctive error type', async () => {
    const store = await freshStore();
    await store.upsert([knowledge({ id: 'k_b', description: 'PrismaClientInitializationError is thrown when...' })]);

    const [result] = await store.search({
      package: 'demo',
      text: 'thrown',
      errorType: 'PrismaClientInitializationError',
    });
    expect(result.signals.exactErrorMatch).toBe(1);
  });

  test('lets confidence break a relevance tie', async () => {
    const store = await freshStore();
    await store.upsert([
      knowledge({ id: 'k_weak', fingerprint: 'fp-weak', confidence: 0.2 }),
      knowledge({ id: 'k_strong', fingerprint: 'fp-strong', confidence: 0.9 }),
    ]);

    const results = await store.search({ package: 'demo', text: 'foo was removed' });
    expect(results[0].knowledge.id).toBe('k_strong');
  });
});

describe('upsert', () => {
  test('accumulates sources instead of overwriting them', async () => {
    // Re-research should add evidence, not discard what a previous run proved.
    const store = await freshStore();
    await store.upsert([knowledge({ fingerprint: 'fp-same' })]);
    await store.upsert([
      knowledge({
        fingerprint: 'fp-same',
        sources: [
          {
            url: 'https://example.com/migration',
            domain: 'example.com',
            sourceType: 'official_migration_guide',
            trustScore: 0.98,
            retrievedAt: new Date().toISOString(),
            contentHash: 'hash2',
          },
        ],
      }),
    ]);

    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0].sources).toHaveLength(2);
    // Sources are ordered by authority.
    expect(all[0].sources[0].sourceType).toBe('official_migration_guide');
  });

  test('never lowers confidence', async () => {
    const store = await freshStore();
    await store.upsert([knowledge({ fingerprint: 'fp-c', confidence: 0.8 })]);
    await store.upsert([knowledge({ fingerprint: 'fp-c', confidence: 0.1 })]);

    expect((await store.all())[0].confidence).toBe(0.8);
  });
});

describe('patch', () => {
  test('can lower confidence, which upsert cannot', async () => {
    // This is why the interface has both: a refuted fix must lose confidence.
    const store = await freshStore();
    await store.upsert([knowledge({ id: 'k_p', fingerprint: 'fp-p', confidence: 0.8 })]);

    const patched = await store.patch('k_p', { confidence: 0.2 });
    expect(patched?.confidence).toBe(0.2);
  });

  test('refuses to change identity', async () => {
    const store = await freshStore();
    await store.upsert([knowledge({ id: 'k_id', fingerprint: 'fp-id' })]);

    const patched = await store.patch('k_id', { id: 'k_other', fingerprint: 'fp-other' } as Partial<KnowledgeObject>);
    expect(patched).toMatchObject({ id: 'k_id', fingerprint: 'fp-id' });
  });

  test('returns null for an unknown id', async () => {
    const store = await freshStore();
    expect(await store.patch('missing', { confidence: 1 })).toBeNull();
  });
});

describe('coverage', () => {
  test('reports whether a package/version pair is already indexed', async () => {
    const store = await freshStore();
    await store.upsert([knowledge({ affected: '>=2.0.0' })]);

    expect(await store.hasCoverage('demo', '2.1.0')).toBe(true);
    expect(await store.hasCoverage('demo', '1.0.0')).toBe(false);
    expect(await store.hasCoverage('other', '2.1.0')).toBe(false);
  });
});

describe('deduplication', () => {
  test('collapses reworded claims and keeps both sources as evidence', async () => {
    const result = deduplicate([
      knowledge({ id: 'k_1', fingerprint: 'fp-1', description: '`foo()` was removed' }),
      knowledge({
        id: 'k_2',
        fingerprint: 'fp-2',
        description: '`foo()` has been removed',
        sources: [
          {
            url: 'https://other.com/notes',
            domain: 'other.com',
            sourceType: 'official_release',
            trustScore: 0.9,
            retrievedAt: new Date().toISOString(),
            contentHash: 'h2',
          },
        ],
      }),
    ]);

    expect(result.knowledge).toHaveLength(1);
    expect(result.collapsed).toBe(1);
    expect(result.knowledge[0].sources).toHaveLength(2);
    // Two independent domains raise confidence above a single source.
    expect(result.knowledge[0].confidence).toBeGreaterThan(0.25);
  });

  test('keeps distinct symbols apart', async () => {
    const result = deduplicate([
      knowledge({ id: 'k_a', fingerprint: 'fp-a', affectedApis: ['foo()'], description: '`foo()` was removed' }),
      knowledge({ id: 'k_b', fingerprint: 'fp-b', affectedApis: ['bar()'], description: '`bar()` was removed' }),
    ]);

    expect(result.knowledge).toHaveLength(2);
  });

  test('flags contradictions', () => {
    const result = deduplicate([
      knowledge({ id: 'k_x', fingerprint: 'fp-x', type: 'removed_api', affectedApis: ['foo()'] }),
      knowledge({ id: 'k_y', fingerprint: 'fp-y', type: 'new_api', affectedApis: ['foo()'], description: 'added foo()' }),
    ]);

    expect(result.contradictions).toHaveLength(1);
  });
});
