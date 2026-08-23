/**
 * Behaviour on a filesystem that cannot be written to.
 *
 * This is not a hypothetical: a serverless function's home directory is
 * read-only, and the deployed site ran there. Every network request succeeded
 * and every one of them was then thrown away by a failing cache write, so the
 * site reported "No sources could be read" while reading every source
 * perfectly well.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readCache, writeCache } from '../research/cache';
import { fetchDocument } from '../research/fetcher';
import { denyDefaultRelay } from '../relay';

const realFetch = globalThis.fetch;
let readOnlyRoot: string;
let previousDataDir: string | undefined;

beforeEach(async () => {
  previousDataDir = process.env.UPGRADE_INTEL_DATA_DIR;
  denyDefaultRelay();

  readOnlyRoot = await mkdtemp(path.join(tmpdir(), 'rift-readonly-'));
  await chmod(readOnlyRoot, 0o555);
  process.env.UPGRADE_INTEL_DATA_DIR = path.join(readOnlyRoot, 'data');
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  if (previousDataDir === undefined) delete process.env.UPGRADE_INTEL_DATA_DIR;
  else process.env.UPGRADE_INTEL_DATA_DIR = previousDataDir;

  await chmod(readOnlyRoot, 0o755).catch(() => {});
  await rm(readOnlyRoot, { recursive: true, force: true });
});

describe('a read-only data directory', () => {
  test('a fetch still returns the document it downloaded', async () => {
    globalThis.fetch = (async () => new Response('<h1>changelog</h1>', { status: 200 })) as unknown as typeof fetch;

    const result = await fetchDocument('https://docs.example.com/changelog', {
      sourceType: 'official_changelog',
      retryDelayMs: 0,
    });

    expect(result.body).toBe('<h1>changelog</h1>');
    expect(result.fromCache).toBe(false);
  });

  test('writeCache does not throw', async () => {
    await writeCache({
      url: 'https://docs.example.com/changelog',
      status: 200,
      body: 'body',
      contentHash: 'hash',
      retrievedAt: new Date().toISOString(),
      transport: 'direct',
    });
  });

  test('reading back returns nothing rather than failing', async () => {
    expect(await readCache('https://docs.example.com/changelog')).toBeNull();
  });

  /**
   * The uncached path has to stay correct, not just non-throwing. Two fetches
   * of the same URL both go to the network, and both return the real body.
   */
  test('every fetch reaches the network, and every one is answered', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(`<h1>call ${calls}</h1>`, { status: 200 });
    }) as unknown as typeof fetch;

    const first = await fetchDocument('https://docs.example.com/a', {
      sourceType: 'official_changelog',
      retryDelayMs: 0,
    });
    const second = await fetchDocument('https://docs.example.com/a', {
      sourceType: 'official_changelog',
      retryDelayMs: 0,
    });

    expect(first.body).toBe('<h1>call 1</h1>');
    expect(second.body).toBe('<h1>call 2</h1>');
    expect(calls).toBe(2);
  });
});
