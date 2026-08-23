import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fetchDocument, FetchError } from '../research/fetcher';
import { branchCandidates, tagCandidates } from '../research/github';

const realFetch = globalThis.fetch;
const temporaries: string[] = [];
let previousDataDir: string | undefined;

beforeEach(async () => {
  // Each test gets its own cache directory. Without this a body cached by one
  // test answers another, and the transport under test is never exercised.
  previousDataDir = process.env.UPGRADE_INTEL_DATA_DIR;
  const directory = await mkdtemp(path.join(tmpdir(), 'upgrade-intel-fetch-'));
  temporaries.push(directory);
  process.env.UPGRADE_INTEL_DATA_DIR = directory;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.BRIGHTDATA_API_KEY;
  if (previousDataDir === undefined) delete process.env.UPGRADE_INTEL_DATA_DIR;
  else process.env.UPGRADE_INTEL_DATA_DIR = previousDataDir;
  await Promise.all(temporaries.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** Records what was requested and answers from a table of responses. */
function stubFetch(responder: (url: string) => Response): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    return responder(url);
  }) as typeof fetch;
  return seen;
}

describe('transport escalation', () => {
  test('an unlocker failure falls back to a direct fetch', async () => {
    // A misconfigured zone should cost coverage, not the run.
    process.env.BRIGHTDATA_API_KEY = 'key';
    const seen = stubFetch((url) =>
      url.includes('brightdata')
        ? new Response('zone misconfigured', { status: 500 })
        : new Response('<h1>direct worked</h1>', { status: 200 }),
    );

    const result = await fetchDocument('https://zonefail.example.com/upgrade', {
      sourceType: 'official_docs',
      retryDelayMs: 0,
    });

    expect(result.body).toContain('direct worked');
    expect(result.transport).toBe('direct');
    // Two attempts on the unlocker, then one direct.
    expect(seen).toHaveLength(3);
  });

  test('an explicit transport is honoured, not second-guessed', async () => {
    process.env.BRIGHTDATA_API_KEY = 'key';
    const seen = stubFetch(() => new Response('blocked', { status: 403 }));

    await expect(
      fetchDocument('https://explicit.example.com/x', {
        sourceType: 'official_docs',
        transport: 'direct',
        retryDelayMs: 0,
      }),
    ).rejects.toThrow('403');
    // One route, retried once. It never reaches for the unlocker.
    expect(seen).toHaveLength(2);
  });
});

describe('retries', () => {
  test('a rate limit is retried before it is reported', async () => {
    // GitHub allows 60 requests an hour without a token. One attempt turns a
    // momentary limit into a source missing from the whole run.
    let calls = 0;
    const seen = stubFetch(() => {
      calls++;
      return calls === 1
        ? new Response('rate limited', { status: 429 })
        : new Response('{"ok":true}', { status: 200 });
    });

    const result = await fetchDocument('https://api.github.com/repos/demo/demo', {
      sourceType: 'official_docs',
      retryDelayMs: 0,
    });

    expect(result.body).toContain('ok');
    expect(seen).toHaveLength(2);
  });

  test('a 404 is an answer and is not retried', async () => {
    // Retrying missing pages would multiply the cost of every speculative probe.
    const seen = stubFetch(() => new Response('nope', { status: 404 }));

    await expect(
      fetchDocument('https://missing.example.com/migration', {
        sourceType: 'official_docs',
        retryDelayMs: 0,
      }),
    ).rejects.toThrow('404');
    expect(seen).toHaveLength(1);
  });

  test('retries are bounded', async () => {
    const seen = stubFetch(() => new Response('down', { status: 503 }));

    await expect(
      fetchDocument('https://down.example.com/docs', { sourceType: 'official_docs', retryDelayMs: 0 }),
    ).rejects.toThrow(FetchError);
    expect(seen).toHaveLength(2);
  });

  test('a network failure is retried too', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      if (calls === 1) throw new Error('socket hang up');
      return new Response('<h1>second try</h1>', { status: 200 });
    });

    const result = await fetchDocument('https://flaky.example.com/docs', {
      sourceType: 'official_docs',
      retryDelayMs: 0,
    });

    expect(result.body).toContain('second try');
    expect(calls).toBe(2);
  });
});

describe('repository guessing', () => {
  test('the known default branch leads, with main and master behind it', () => {
    // A repository on `trunk` or `develop` used to 404 on every in-repo probe.
    expect(branchCandidates('trunk')).toEqual(['trunk', 'main', 'master']);
  });

  test('an unknown default branch falls back to the two common names', () => {
    expect(branchCandidates(null)).toEqual(['main', 'master']);
  });

  test('the known branch is not repeated', () => {
    expect(branchCandidates('main')).toEqual(['main', 'master']);
  });

  test('monorepo tag spellings are tried too', () => {
    // changesets and Lerna publish as `package@1.2.3`, which neither `v1.2.3`
    // nor `1.2.3` finds.
    expect(tagCandidates('5.0.0', '@scope/thing')).toEqual([
      'v5.0.0',
      '5.0.0',
      '@scope/thing@5.0.0',
      'thing@5.0.0',
    ]);
  });

  test('without a package name, only the two version spellings are tried', () => {
    expect(tagCandidates('5.0.0')).toEqual(['v5.0.0', '5.0.0']);
  });
});
