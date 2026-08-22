import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveError } from '../errorPipeline';
import { JsonKnowledgeStore } from '../index/store';
import { SOURCE_TRUST, type KnowledgeObject, type KnowledgeType, type SourceType } from '../knowledge';

const temporaries: string[] = [];

async function freshStore() {
  const directory = await mkdtemp(path.join(tmpdir(), 'upgrade-intel-error-'));
  temporaries.push(directory);
  return new JsonKnowledgeStore(path.join(directory, 'index.json'));
}

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function knowledge(
  id: string,
  type: KnowledgeType,
  sourceType: SourceType,
  title: string,
  overrides: Partial<KnowledgeObject> = {},
): KnowledgeObject {
  const now = new Date().toISOString();
  return {
    id,
    type,
    package: 'chalk',
    ecosystem: 'nodejs',
    introduced: '5.0.0',
    affected: '>=5.0.0',
    title,
    description: title,
    affectedApis: [],
    affectedConfig: [],
    migration: [],
    severity: 'HIGH',
    provenance: sourceType === 'official_issue' ? 'community' : 'official',
    sources: [
      {
        url: `https://example.com/${id}`,
        domain: 'example.com',
        sourceType,
        trustScore: SOURCE_TRUST[sourceType],
        retrievedAt: now,
        contentHash: id,
        quotedText: title,
      },
    ],
    confidence: 0.35,
    fingerprint: `fp_${id}`,
    embedding: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const ERROR = {
  package: 'chalk',
  version: '5.6.2',
  error: 'TypeError: chalk.green is not a function',
  stackTrace: 'at banner (src/run.js:4:16)',
  indexOnly: true,
};

describe('symptom versus cause', () => {
  test('an authoritative cause leads the diagnosis, not the matching symptom', async () => {
    // The issue quotes the error verbatim and wins every relevance contest. The
    // release note that explains it shares not one word with the message. Ranked
    // together the cause is never the answer, which is the wrong outcome for
    // "why is this happening".
    const store = await freshStore();
    await store.upsert([
      knowledge('k_issue', 'github_issue', 'official_issue', 'TypeError: chalk.green is not a function'),
      knowledge('k_cause', 'breaking_change', 'official_release', 'This package is now pure ESM.'),
    ]);

    const resolution = await resolveError({ ...ERROR, store });

    expect(resolution.likelyCause).toContain('pure ESM');
  });

  test('a change about other symbols loses to a general one', async () => {
    // chalk 5 removed `.keyword()` and `.hsl()`. That is a real breaking change
    // and a poor explanation of why `chalk.green` is undefined — it names APIs
    // the error never mentions.
    const store = await freshStore();
    await store.upsert([
      knowledge('k_other', 'removed_api', 'official_release', 'Remove .keyword() and .hsl() color models', {
        affectedApis: ['keyword()', 'hsl()'],
      }),
      knowledge('k_general', 'breaking_change', 'official_release', 'This package is now pure ESM.'),
    ]);

    const resolution = await resolveError({ ...ERROR, store });

    expect(resolution.likelyCause).toContain('pure ESM');
  });

  test('a change naming the failing symbol wins outright', async () => {
    const store = await freshStore();
    await store.upsert([
      knowledge('k_general', 'breaking_change', 'official_release', 'This package is now pure ESM.'),
      knowledge('k_exact', 'removed_api', 'official_release', 'Removed the green color method', {
        affectedApis: ['green()'],
      }),
    ]);

    const resolution = await resolveError({ ...ERROR, store });

    expect(resolution.likelyCause).toContain('green');
  });

  test('the package name is not a symbol match', async () => {
    // `chalk.green` names `green`. Treating `chalk` as a symbol made every claim
    // about the package match every error from it — "chalk.Instance → Chalk"
    // was picked to explain a missing `green`.
    const store = await freshStore();
    await store.upsert([
      knowledge('k_receiver', 'renamed_api', 'official_release', 'chalk.Instance is now Chalk', {
        affectedApis: ['chalk.Instance', 'Chalk'],
      }),
      knowledge('k_general', 'breaking_change', 'official_release', 'This package is now pure ESM.'),
    ]);

    const resolution = await resolveError({ ...ERROR, store });

    expect(resolution.likelyCause).toContain('pure ESM');
  });

  test('with no authoritative cause, the best symptom match still answers', async () => {
    // Degradation, not silence: an issue is worse evidence than a release note,
    // and better than nothing.
    const store = await freshStore();
    await store.upsert([
      knowledge('k_issue', 'github_issue', 'official_issue', 'TypeError: chalk.green is not a function'),
    ]);

    const resolution = await resolveError({ ...ERROR, store });

    expect(resolution.likelyCause).toContain('chalk.green');
    expect(resolution.confidenceCategory).toBe('Low');
  });
});

describe('validated knowledge', () => {
  test('a repository-validated claim answers at its raised confidence', async () => {
    // Feedback told the user "35% -> 55%". Recomputing from sources alone
    // discarded that and answered 35% the next time they asked.
    const store = await freshStore();
    await store.upsert([
      knowledge('k_cause', 'breaking_change', 'official_release', 'This package is now pure ESM.', {
        confidence: 0.55,
        validation: { validatedAt: new Date().toISOString(), confirmations: 1, refutations: 0 },
      }),
    ]);

    const resolution = await resolveError({ ...ERROR, store });

    expect(resolution.confidence).toBeCloseTo(0.55, 5);
  });
});
