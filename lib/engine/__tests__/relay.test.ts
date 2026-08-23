/**
 * The relay is the path a user with no keys takes, so these tests are written
 * from that user's position: does the work happen, does a local key still win,
 * and — the one that matters most — is a keyless caller ever left worse off
 * than they were before a relay existed.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { relayConfigured, relayOrigin, resetRelayAvailability } from '../relay';
import { checkRelayTarget } from '../relayTarget';
import { checkRateLimit, resetRateLimits, callerKey } from '../relayGuard';
import { fetchDocument } from '../research/fetcher';
import { searchWeb } from '../research/search';

const realFetch = globalThis.fetch;
const temporaries: string[] = [];
const saved: Record<string, string | undefined> = {};
const TOUCHED = [
  'RIFT_RELAY_URL',
  'BRIGHTDATA_API_KEY',
  'BRIGHTDATA_ZONE',
  'BRIGHTDATA_SERP_ZONE',
  'UPGRADE_INTEL_DATA_DIR',
];

beforeEach(async () => {
  for (const key of TOUCHED) saved[key] = process.env[key];
  for (const key of TOUCHED) delete process.env[key];

  // Own cache directory per test: a body cached by one test would answer
  // another, and the transport under test would never run.
  const directory = await mkdtemp(path.join(tmpdir(), 'rift-relay-'));
  temporaries.push(directory);
  process.env.UPGRADE_INTEL_DATA_DIR = directory;

  resetRateLimits();
  resetRelayAvailability();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await Promise.all(temporaries.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** Records every request and answers from a table keyed on the URL. */
function stubFetch(responder: (url: string, init?: RequestInit) => Response): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    return responder(url, init);
  }) as typeof fetch;
  return seen;
}

const relayBody = (body: string) =>
  new Response(JSON.stringify({ status: 200, body, contentType: 'text/html' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('relayOrigin', () => {
  test('is undefined when nothing is configured', () => {
    expect(relayOrigin()).toBeUndefined();
    expect(relayConfigured()).toBe(false);
  });

  test('uses RIFT_RELAY_URL and trims the trailing slash', () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com/';
    expect(relayOrigin()).toBe('https://rift.example.com');
  });

  test('"off" opts out even when a default would otherwise apply', () => {
    process.env.RIFT_RELAY_URL = 'off';
    expect(relayOrigin()).toBeUndefined();
    expect(relayConfigured()).toBe(false);
  });
});

describe('fetching through the relay', () => {
  test('a keyless caller reaches a blocking host through the relay', async () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com';

    const seen = stubFetch((url) => {
      if (url === 'https://rift.example.com/api/relay/fetch') return relayBody('<h1>changelog</h1>');
      return new Response('blocked', { status: 403 });
    });

    const result = await fetchDocument('https://docs.example.com/changelog', {
      sourceType: 'official_changelog',
      retryDelayMs: 0,
    });

    expect(result.body).toBe('<h1>changelog</h1>');
    expect(result.transport).toBe('relay');
    expect(seen).toEqual(['https://rift.example.com/api/relay/fetch']);
  });

  test('a local Bright Data key is preferred over the relay', async () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com';
    process.env.BRIGHTDATA_API_KEY = 'local-key';

    const seen = stubFetch(() => new Response('<h1>own quota</h1>', { status: 200 }));

    const result = await fetchDocument('https://docs.example.com/changelog', {
      sourceType: 'official_changelog',
      retryDelayMs: 0,
    });

    expect(result.transport).toBe('brightdata');
    expect(seen).toEqual(['https://api.brightdata.com/request']);
  });

  test('JSON APIs stay direct — the relay is not spent on machine-readable hosts', async () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com';

    const seen = stubFetch(() => new Response('{"ok":true}', { status: 200 }));

    const result = await fetchDocument('https://registry.npmjs.org/chalk', {
      sourceType: 'package_registry',
      retryDelayMs: 0,
    });

    expect(result.transport).toBe('direct');
    expect(seen).toEqual(['https://registry.npmjs.org/chalk']);
  });

  /**
   * The point of the whole design. The relay is somebody else's deployment: it
   * can be down, rate-limited, or never deployed at all. If that turned a fetch
   * that used to succeed into a failure, adding the relay would have made the
   * keyless experience worse rather than better.
   */
  test('a dead relay falls back to a direct fetch', async () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com';

    const seen = stubFetch((url) => {
      if (url === 'https://rift.example.com/api/relay/fetch') return new Response('down', { status: 503 });
      return new Response('<h1>direct worked</h1>', { status: 200 });
    });

    const result = await fetchDocument('https://docs.example.com/changelog', {
      sourceType: 'official_changelog',
      retryDelayMs: 0,
    });

    expect(result.body).toBe('<h1>direct worked</h1>');
    expect(result.transport).toBe('direct');
    expect(seen).toContain('https://docs.example.com/changelog');
  });

  /**
   * A deployment with a SERP zone and no unlocker is the expected shape, not an
   * edge case: documentation sites do not block plain requests, so the unlocker
   * is the one product there is no reason to pay for. Before this, a single
   * research run asked such a relay eighteen times and fell back eighteen
   * times, paying a round trip for each refusal.
   */
  test('a relay with no unlocker is asked once, then skipped', async () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com';

    const seen = stubFetch((url) => {
      if (url === 'https://rift.example.com/api/relay/fetch') {
        return new Response(JSON.stringify({ error: 'no relay credentials' }), { status: 503 });
      }
      return new Response('<h1>direct</h1>', { status: 200 });
    });

    for (const page of ['one', 'two', 'three']) {
      const result = await fetchDocument(`https://docs.example.com/${page}`, {
        sourceType: 'official_changelog',
        retryDelayMs: 0,
      });
      expect(result.transport).toBe('direct');
    }

    const relayCalls = seen.filter((url) => url.endsWith('/api/relay/fetch'));
    expect(relayCalls).toHaveLength(1);
  });

  /**
   * Legs are tracked separately. The SERP zone is the half that raises
   * confidence, and a missing unlocker must not take it down too.
   */
  test('a missing unlocker does not disable relay search', async () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com';

    stubFetch((url) => {
      if (url.endsWith('/api/relay/fetch')) return new Response('{}', { status: 503 });
      if (url.endsWith('/api/relay/search')) {
        return new Response(JSON.stringify({ results: [{ url: 'https://nextjs.org/docs/upgrading', title: 'Guide' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('<h1>direct</h1>', { status: 200 });
    });

    await fetchDocument('https://docs.example.com/changelog', { sourceType: 'official_changelog', retryDelayMs: 0 });

    expect(await searchWeb('next migration guide')).toHaveLength(1);
  });

  test('an explicit transport is honoured and never escalates to the relay', async () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com';

    const seen = stubFetch(() => new Response('<h1>direct</h1>', { status: 200 }));

    await fetchDocument('https://docs.example.com/changelog', {
      sourceType: 'official_changelog',
      transport: 'direct',
      retryDelayMs: 0,
    });

    expect(seen).toEqual(['https://docs.example.com/changelog']);
  });
});

describe('search through the relay', () => {
  test('a keyless caller still gets discovery results', async () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com';

    stubFetch(() =>
      new Response(
        JSON.stringify({
          results: [{ url: 'https://nextjs.org/docs/upgrading', title: 'Upgrade Guide', snippet: 'how to upgrade' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const results = await searchWeb('next 13 to 14 migration guide');

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://nextjs.org/docs/upgrading');
    // Reclassified locally, never trusted from the wire: authority tier decides
    // how much a claim is worth, so that call belongs to the extracting machine.
    expect(results[0].sourceType).toBe('official_migration_guide');
  });

  test('no relay and no SERP zone stays an empty result, not an error', async () => {
    stubFetch(() => new Response('should not be called', { status: 500 }));
    expect(await searchWeb('anything')).toEqual([]);
  });

  test('a failing relay degrades to no discovery rather than throwing', async () => {
    process.env.RIFT_RELAY_URL = 'https://rift.example.com';
    stubFetch(() => new Response('nope', { status: 500 }));
    expect(await searchWeb('anything')).toEqual([]);
  });
});

describe('checkRelayTarget', () => {
  test('accepts an ordinary documentation URL', () => {
    expect(checkRelayTarget('https://nextjs.org/docs/upgrading').ok).toBe(true);
  });

  /**
   * The route fetches an anonymous caller's URL with our credentials. Each of
   * these is a way to point that at something inside the deployment rather than
   * at a documentation page.
   */
  test.each([
    ['http://localhost:3000/api/relay/fetch'],
    ['http://127.0.0.1/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://metadata.google.internal/'],
    ['http://10.0.0.5/internal'],
    ['http://192.168.1.1/'],
    ['http://172.16.0.1/'],
    ['file:///etc/passwd'],
    ['gopher://example.com/'],
  ])('rejects %s', (url) => {
    expect(checkRelayTarget(url).ok).toBe(false);
  });

  test('rejects a missing or non-string url', () => {
    expect(checkRelayTarget(undefined).ok).toBe(false);
    expect(checkRelayTarget('').ok).toBe(false);
    expect(checkRelayTarget(42).ok).toBe(false);
    expect(checkRelayTarget('not a url').ok).toBe(false);
  });
});

describe('checkRateLimit', () => {
  test('allows a burst up to the limit, then refuses with a retry hint', () => {
    process.env.RIFT_RELAY_RATE_LIMIT = '3';
    try {
      expect(checkRateLimit('1.2.3.4').allowed).toBe(true);
      expect(checkRateLimit('1.2.3.4').allowed).toBe(true);
      expect(checkRateLimit('1.2.3.4').allowed).toBe(true);

      const refused = checkRateLimit('1.2.3.4');
      expect(refused.allowed).toBe(false);
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    } finally {
      delete process.env.RIFT_RELAY_RATE_LIMIT;
    }
  });

  test('one caller exhausting the budget does not refuse another', () => {
    process.env.RIFT_RELAY_RATE_LIMIT = '2';
    try {
      checkRateLimit('1.2.3.4');
      checkRateLimit('1.2.3.4');
      expect(checkRateLimit('1.2.3.4').allowed).toBe(false);
      expect(checkRateLimit('5.6.7.8').allowed).toBe(true);
    } finally {
      delete process.env.RIFT_RELAY_RATE_LIMIT;
    }
  });

  test('the window expires', () => {
    process.env.RIFT_RELAY_RATE_LIMIT = '1';
    try {
      const start = 1_000_000;
      expect(checkRateLimit('1.2.3.4', start).allowed).toBe(true);
      expect(checkRateLimit('1.2.3.4', start + 1_000).allowed).toBe(false);
      expect(checkRateLimit('1.2.3.4', start + 61_000).allowed).toBe(true);
    } finally {
      delete process.env.RIFT_RELAY_RATE_LIMIT;
    }
  });

  test('callerKey reads the first forwarded hop', () => {
    expect(callerKey(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(callerKey(new Headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
    expect(callerKey(new Headers())).toBe('unknown');
  });
});
