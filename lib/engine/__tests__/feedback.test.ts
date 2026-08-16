import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { recordFixOutcome, type FixReport } from '../feedback';
import { JsonKnowledgeStore } from '../index/store';
import { SOURCE_TRUST, type KnowledgeObject } from '../knowledge';

const temporaries: string[] = [];

async function freshStore() {
  const directory = await mkdtemp(path.join(tmpdir(), 'upgrade-intel-feedback-'));
  temporaries.push(directory);
  return new JsonKnowledgeStore(path.join(directory, 'index.json'));
}

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function officialKnowledge(): KnowledgeObject {
  const now = new Date().toISOString();
  return {
    id: 'k_official',
    type: 'breaking_change',
    package: 'demo',
    ecosystem: 'nodejs',
    toVersion: '2.0.0',
    introduced: '2.0.0',
    title: 'params must be awaited',
    description: 'Dynamic APIs are now async',
    affectedApis: ['params'],
    affectedConfig: [],
    migration: [],
    severity: 'HIGH',
    provenance: 'official',
    sources: [
      {
        url: 'https://example.com/releases/2.0.0',
        domain: 'example.com',
        sourceType: 'official_release',
        trustScore: SOURCE_TRUST.official_release,
        retrievedAt: now,
        contentHash: 'hash',
      },
    ],
    confidence: 0.35,
    fingerprint: 'fp_official',
    embedding: null,
    createdAt: now,
    updatedAt: now,
  };
}

function report(overrides: Partial<FixReport> = {}): FixReport {
  return {
    package: 'demo',
    version: '2.0.0',
    summary: 'Await params in dynamic segments',
    fix: [{ kind: 'replace', description: 'await params', before: 'params.slug', after: '(await params).slug' }],
    derivedFrom: ['k_official'],
    validation: { tests: 'passed', typecheck: 'passed' },
    repository: '/repo/one',
    ...overrides,
  };
}

describe('successful validation', () => {
  test('records the fix as repository-verified and reinforces its source', async () => {
    const store = await freshStore();
    await store.upsert([officialKnowledge()]);

    const result = await recordFixOutcome(report({ store }));

    expect(result.succeeded).toBe(true);
    expect(result.recorded?.provenance).toBe('verified_repository');
    expect(result.recorded?.validation?.confirmations).toBe(1);

    // The knowledge the agent acted on gains the validation signal.
    expect(result.reinforced).toHaveLength(1);
    expect(result.reinforced[0].after).toBeGreaterThan(result.reinforced[0].before);
  });

  test('counts a second repository as an independent confirmation', async () => {
    const store = await freshStore();
    await store.upsert([officialKnowledge()]);

    const first = await recordFixOutcome(report({ store, repository: '/repo/one' }));
    const second = await recordFixOutcome(report({ store, repository: '/repo/two' }));

    expect(second.recorded?.validation?.confirmations).toBe(2);
    expect(second.recorded!.confidence).toBeGreaterThan(first.recorded!.confidence);
  });

  test('ignores a repeat report from the same repository', async () => {
    // Otherwise one repository could inflate confidence by reporting in a loop.
    const store = await freshStore();
    await store.upsert([officialKnowledge()]);

    await recordFixOutcome(report({ store, repository: '/repo/one' }));
    const repeat = await recordFixOutcome(report({ store, repository: '/repo/one' }));

    expect(repeat.recorded?.validation?.confirmations).toBe(1);
    expect(repeat.reinforced).toHaveLength(0);
  });
});

describe('failed validation', () => {
  test('records a refutation and lowers confidence', async () => {
    const store = await freshStore();
    await store.upsert([officialKnowledge()]);

    const success = await recordFixOutcome(report({ store, repository: '/repo/one' }));
    const failure = await recordFixOutcome(
      report({ store, repository: '/repo/two', validation: { tests: 'failed' } }),
    );

    expect(failure.succeeded).toBe(false);
    expect(failure.recorded!.confidence).toBeLessThan(success.recorded!.confidence);
    expect(failure.recorded?.validation?.refutations).toBe(1);
    expect(failure.recorded?.provenance).toBe('agent_generated');
  });

  test('marks the cited knowledge contradicted rather than reinforcing it', async () => {
    const store = await freshStore();
    await store.upsert([officialKnowledge()]);

    const result = await recordFixOutcome(report({ store, validation: { tests: 'failed' } }));

    expect(result.reinforced[0].after).toBeLessThan(0.35 + 0.2);
    const cited = await store.get('k_official');
    expect(cited?.validation?.refutations).toBe(1);
  });
});

describe('validation semantics', () => {
  test('all-skipped is not a success', async () => {
    // Nothing was actually run, so nothing was proven.
    const store = await freshStore();
    const result = await recordFixOutcome(
      report({ store, validation: { tests: 'skipped', typecheck: 'skipped' } }),
    );

    expect(result.succeeded).toBe(false);
  });

  test('a single failure among passes is not a success', async () => {
    const store = await freshStore();
    const result = await recordFixOutcome(
      report({ store, validation: { tests: 'passed', typecheck: 'passed', build: 'failed' } }),
    );

    expect(result.succeeded).toBe(false);
  });
});

describe('confidence ceiling', () => {
  test('an uncorroborated verified fix stays below the assertion threshold', async () => {
    const store = await freshStore();
    const result = await recordFixOutcome(report({ store, derivedFrom: [] }));

    expect(result.recorded!.confidence).toBeLessThan(0.75);
  });
});
