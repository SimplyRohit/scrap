import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { backfillEmbeddings, needsEmbedding } from '../index/backfill';
import {
  embedAll,
  embedQuery,
  registerEmbedder,
  type Embedder,
  type EmbeddingKind,
} from '../index/embeddings';
import { JsonKnowledgeStore } from '../index/store';
import { SOURCE_TRUST, type KnowledgeObject } from '../knowledge';
import { VoyageEmbedder } from '../index/voyage';

const temporaries: string[] = [];

async function freshStore() {
  const directory = await mkdtemp(path.join(tmpdir(), 'upgrade-intel-embed-'));
  temporaries.push(directory);
  return new JsonKnowledgeStore(path.join(directory, 'index.json'));
}

afterEach(async () => {
  registerEmbedder(null);
  await Promise.all(temporaries.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function knowledge(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
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
        sourceType: 'official_changelog',
        trustScore: SOURCE_TRUST.official_changelog,
        retrievedAt: now,
        contentHash: 'hash',
      },
    ],
    confidence: 0.5,
    fingerprint: `fp_${overrides.id ?? Math.random().toString(36).slice(2, 8)}`,
    embedding: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** A deterministic stand-in: no network, but every distinct text gets a distinct vector. */
function fakeEmbedder(overrides: Partial<Embedder> = {}): Embedder & { calls: { texts: string[]; kind?: EmbeddingKind }[] } {
  const calls: { texts: string[]; kind?: EmbeddingKind }[] = [];
  return {
    id: 'fake:v1',
    dimensions: 3,
    async embed(texts, kind) {
      calls.push({ texts, kind });
      return texts.map((text) => [text.length % 7, text.length % 5, 1]);
    },
    calls,
    ...overrides,
  } as Embedder & { calls: { texts: string[]; kind?: EmbeddingKind }[] };
}

function voyageResponse(vectors: number[][]): Response {
  return new Response(
    JSON.stringify({ data: vectors.map((embedding, index) => ({ embedding, index })) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const noSleep = async () => {};

describe('voyage transport', () => {
  test('sends the query input type for a query and the document type for a document', async () => {
    const bodies: Record<string, unknown>[] = [];
    const embedder = new VoyageEmbedder({
      apiKey: 'k',
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return voyageResponse([new Array(1024).fill(0.1)]);
      },
      sleep: noSleep,
    });

    await embedder.embed(['a claim'], 'document');
    await embedder.embed(['a question'], 'query');

    // Voyage encodes the two asymmetrically; sending everything as one kind
    // quietly costs retrieval quality with no visible error.
    expect(bodies.map((body) => body.input_type)).toEqual(['document', 'query']);
    expect(bodies[0].model).toBe('voyage-3.5-lite');
  });

  test('orders vectors by the response index, not by arrival', async () => {
    const embedder = new VoyageEmbedder({
      apiKey: 'k',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              { embedding: new Array(1024).fill(2), index: 1 },
              { embedding: new Array(1024).fill(1), index: 0 },
            ],
          }),
          { status: 200 },
        ),
      sleep: noSleep,
    });

    const [first, second] = await embedder.embed(['one', 'two']);
    expect(first[0]).toBe(1);
    expect(second[0]).toBe(2);
  });

  test('retries a rate limit and succeeds', async () => {
    let attempts = 0;
    const embedder = new VoyageEmbedder({
      apiKey: 'k',
      fetchImpl: async () => {
        attempts++;
        if (attempts === 1) return new Response('slow down', { status: 429 });
        return voyageResponse([new Array(1024).fill(0.5)]);
      },
      sleep: noSleep,
    });

    const [vector] = await embedder.embed(['text']);
    expect(attempts).toBe(2);
    expect(vector).toHaveLength(1024);
  });

  test('does not retry a bad key', async () => {
    // Retrying a 401 burns three requests to be told the same thing.
    let attempts = 0;
    const embedder = new VoyageEmbedder({
      apiKey: 'wrong',
      fetchImpl: async () => {
        attempts++;
        return new Response('unauthorized', { status: 401 });
      },
      sleep: noSleep,
    });

    await expect(embedder.embed(['text'])).rejects.toThrow('401');
    expect(attempts).toBe(1);
  });

  test('rejects a vector of unexpected width rather than storing it', async () => {
    const embedder = new VoyageEmbedder({
      apiKey: 'k',
      fetchImpl: async () => voyageResponse([[1, 2, 3]]),
      sleep: noSleep,
    });

    await expect(embedder.embed(['text'])).rejects.toThrow('dimension');
  });

  test('splits a large batch across requests', async () => {
    let requests = 0;
    const embedder = new VoyageEmbedder({
      apiKey: 'k',
      fetchImpl: async (_url, init) => {
        requests++;
        const { input } = JSON.parse(String(init?.body)) as { input: string[] };
        return voyageResponse(input.map(() => new Array(1024).fill(0)));
      },
      sleep: noSleep,
    });

    const vectors = await embedder.embed(new Array(200).fill('text'));
    expect(vectors).toHaveLength(200);
    expect(requests).toBe(3);
  });
});

describe('rate limits', () => {
  test('splits on the token ceiling before the count ceiling', async () => {
    // A free Voyage key is capped at 10K tokens a minute. Ten long changelog
    // entries are well under 96 inputs and well over that ceiling, so batching
    // by count alone gets the whole request rejected.
    const sizes: number[] = [];
    const embedder = new VoyageEmbedder({
      apiKey: 'k',
      batchTokens: 1_000,
      fetchImpl: async (_url, init) => {
        const { input } = JSON.parse(String(init?.body)) as { input: string[] };
        sizes.push(input.length);
        return voyageResponse(input.map(() => new Array(1024).fill(0)));
      },
      sleep: noSleep,
    });

    // 2000 characters ≈ 500 tokens each, so two per request.
    await embedder.embed(new Array(6).fill('x'.repeat(2_000)));
    expect(sizes).toEqual([2, 2, 2]);
  });

  test('paces requests when a per-minute limit is set', async () => {
    const waits: number[] = [];
    const embedder = new VoyageEmbedder({
      apiKey: 'k',
      requestsPerMinute: 3,
      batchTokens: 10,
      fetchImpl: async (_url, init) => {
        const { input } = JSON.parse(String(init?.body)) as { input: string[] };
        return voyageResponse(input.map(() => new Array(1024).fill(0)));
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await embedder.embed(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);

    // Spacing requests beats discovering the limit through 429s: the second
    // request waits out most of the 20-second window rather than being rejected.
    expect(waits.filter((ms) => ms > 0)).toHaveLength(1);
    expect(waits[waits.length - 1]).toBeLessThanOrEqual(20_000);
  });

  test('waits out a per-minute limit instead of retrying in milliseconds', async () => {
    // The first backoff used to be 500ms, which against a 3-requests-per-minute
    // cap simply spent all three attempts inside the same rejected window.
    const waits: number[] = [];
    let attempts = 0;
    const embedder = new VoyageEmbedder({
      apiKey: 'k',
      fetchImpl: async () => {
        attempts++;
        if (attempts < 3) return new Response('rate limited', { status: 429 });
        return voyageResponse([new Array(1024).fill(0)]);
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await embedder.embed(['text']);
    expect(waits[0]).toBeGreaterThanOrEqual(2_000);
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });

  test('honours retry-after over the backoff schedule', async () => {
    const waits: number[] = [];
    let attempts = 0;
    const embedder = new VoyageEmbedder({
      apiKey: 'k',
      fetchImpl: async () => {
        attempts++;
        if (attempts === 1) {
          return new Response('rate limited', { status: 429, headers: { 'retry-after': '5' } });
        }
        return voyageResponse([new Array(1024).fill(0)]);
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await embedder.embed(['text']);
    expect(waits).toEqual([5_000]);
  });
});

describe('degraded operation', () => {
  test('embedAll returns null with no embedder registered', async () => {
    expect(await embedAll(['text'])).toBeNull();
  });

  test('a failing provider degrades the query to lexical instead of failing the search', async () => {
    registerEmbedder({
      id: 'broken',
      dimensions: 3,
      async embed() {
        throw new Error('provider down');
      },
    });

    expect(await embedQuery('why did this break')).toBeNull();
  });

  test('backfill reports that it did nothing when no embedder is configured', async () => {
    const store = await freshStore();
    await store.upsert([knowledge()]);

    const result = await backfillEmbeddings({ store });
    expect(result.model).toBeNull();
    expect(result.embedded).toBe(0);
  });
});

describe('backfill', () => {
  test('embeds only what is missing and records the model', async () => {
    const store = await freshStore();
    await store.upsert([
      knowledge({ id: 'k_a', fingerprint: 'fp_a' }),
      knowledge({ id: 'k_b', fingerprint: 'fp_b', embedding: [1, 2, 3], embeddingModel: 'fake:v1' }),
    ]);

    const embedder = fakeEmbedder();
    registerEmbedder(embedder);

    const result = await backfillEmbeddings({ store });

    expect(result.pending).toBe(1);
    expect(result.embedded).toBe(1);
    expect((await store.get('k_a'))?.embeddingModel).toBe('fake:v1');
    // Documents, not queries: these are stored claims.
    expect(embedder.calls[0].kind).toBe('document');
  });

  test('re-embeds a vector left behind by a different model', async () => {
    // A vector from another model is worse than no vector: it still scores.
    const store = await freshStore();
    await store.upsert([knowledge({ id: 'k_a', fingerprint: 'fp_a', embedding: [9, 9], embeddingModel: 'old:v0' })]);

    registerEmbedder(fakeEmbedder());
    const result = await backfillEmbeddings({ store });

    expect(result.embedded).toBe(1);
    expect((await store.get('k_a'))?.embedding).toHaveLength(3);
  });

  test('is a no-op on a second run', async () => {
    const store = await freshStore();
    await store.upsert([knowledge({ id: 'k_a', fingerprint: 'fp_a' })]);
    registerEmbedder(fakeEmbedder());

    await backfillEmbeddings({ store });
    const second = await backfillEmbeddings({ store });

    expect(second.pending).toBe(0);
    expect(second.embedded).toBe(0);
  });

  test('keeps what it wrote when a chunk fails, and leaves the rest pending', async () => {
    const store = await freshStore();
    await store.upsert(
      Array.from({ length: 40 }, (_, index) => knowledge({ id: `k_${index}`, fingerprint: `fp_${index}` })),
    );

    let chunk = 0;
    registerEmbedder({
      id: 'flaky:v1',
      dimensions: 3,
      async embed(texts) {
        chunk++;
        if (chunk === 2) throw new Error('provider down');
        return texts.map(() => [1, 0, 0]);
      },
    });

    const result = await backfillEmbeddings({ store });

    expect(result.embedded).toBe(32);
    expect(result.remaining).toBe(8);
    expect(result.failures).toHaveLength(1);
  });

  test('respects a limit so one call cannot spend unbounded budget', async () => {
    const store = await freshStore();
    await store.upsert(
      Array.from({ length: 10 }, (_, index) => knowledge({ id: `k_${index}`, fingerprint: `fp_${index}` })),
    );
    registerEmbedder(fakeEmbedder());

    const result = await backfillEmbeddings({ store, limit: 4 });
    expect(result.embedded).toBe(4);
    expect(result.remaining).toBe(6);
  });

  test('embeds only the ids it was given', async () => {
    // Used right after indexing: the run embeds what it just wrote rather than
    // sweeping the whole index, so a first-contact answer is hybrid, not lexical.
    const store = await freshStore();
    await store.upsert([
      knowledge({ id: 'k_new', fingerprint: 'fp_new' }),
      knowledge({ id: 'k_old', fingerprint: 'fp_old' }),
    ]);
    registerEmbedder(fakeEmbedder());

    const result = await backfillEmbeddings({ store, ids: ['k_new'] });

    expect(result.embedded).toBe(1);
    expect((await store.get('k_new'))?.embedding).not.toBeNull();
    expect((await store.get('k_old'))?.embedding).toBeNull();
  });

  test('needsEmbedding treats an unlabelled vector as stale', () => {
    expect(needsEmbedding(knowledge({ embedding: [1, 2, 3] }), 'fake:v1')).toBe(true);
    expect(needsEmbedding(knowledge({ embedding: [1, 2, 3], embeddingModel: 'fake:v1' }), 'fake:v1')).toBe(false);
  });
});

describe('semantic scoring', () => {
  test('scores a vector from the active model', async () => {
    const store = await freshStore();
    await store.upsert([knowledge({ id: 'k_a', fingerprint: 'fp_a', embedding: [1, 0, 0], embeddingModel: 'fake:v1' })]);
    registerEmbedder(fakeEmbedder());

    const [result] = await store.search({ package: 'demo', text: 'foo', embedding: [1, 0, 0] });
    expect(result.signals.semantic).toBeCloseTo(1, 5);
  });

  test('ignores a vector produced by a different model', async () => {
    // Cosine between two models' spaces is a number, not a similarity. Scoring
    // it would look confident and mean nothing.
    const store = await freshStore();
    await store.upsert([knowledge({ id: 'k_a', fingerprint: 'fp_a', embedding: [1, 0, 0], embeddingModel: 'old:v0' })]);
    registerEmbedder(fakeEmbedder());

    const [result] = await store.search({ package: 'demo', text: 'foo', embedding: [1, 0, 0] });
    expect(result.signals.semantic).toBe(0);
  });

  test('stats report the models behind the stored vectors', async () => {
    const store = await freshStore();
    await store.upsert([
      knowledge({ id: 'k_a', fingerprint: 'fp_a', embedding: [1, 0, 0], embeddingModel: 'fake:v1' }),
      knowledge({ id: 'k_b', fingerprint: 'fp_b', embedding: [0, 1, 0], embeddingModel: 'old:v0' }),
    ]);

    const stats = await store.stats();
    expect(stats.withEmbeddings).toBe(2);
    expect(stats.embeddingModels).toEqual(['fake:v1', 'old:v0']);
  });
});
