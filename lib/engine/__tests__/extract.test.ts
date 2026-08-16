import { describe, expect, test } from 'bun:test';

import { extractKnowledge, type ExtractionContext } from '../analysis/extract';
import { parseMarkdown } from '../analysis/normalize';
import { SOURCE_TRUST } from '../knowledge';

function contextFor(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    package: 'demo',
    ecosystem: 'nodejs',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    documentVersion: '2.0.0',
    source: {
      url: 'https://github.com/demo/demo/releases/tag/v2.0.0',
      domain: 'github.com',
      sourceType: 'official_release',
      trustScore: SOURCE_TRUST.official_release,
      retrievedAt: new Date().toISOString(),
      contentHash: 'hash',
      title: 'demo v2.0.0',
    },
    ...overrides,
  };
}

const extract = (markdown: string, overrides?: Partial<ExtractionContext>) =>
  extractKnowledge(parseMarkdown(markdown), contextFor(overrides));

describe('classification by Keep a Changelog heading', () => {
  test('the heading wins over stray prose', () => {
    // Regression: "Added a clear() function so interceptors can be removed" was
    // classified as a removed API because "removed" appears in the description.
    const knowledge = extract(
      '### Added\n\n- Added a `clear()` function so that all interceptors can be removed from an instance',
    );

    expect(knowledge.every((item) => item.type !== 'removed_api')).toBe(true);
  });

  test('a Removed heading yields removals', () => {
    const knowledge = extract('### Removed\n\n- `foo()` has been removed');
    expect(knowledge[0]).toMatchObject({ type: 'removed_api' });
  });
});

describe('breaking-change detection', () => {
  test('recognises announcement forms', () => {
    const knowledge = extract('## Changes\n\n- [Breaking] Disable automatic fetch caching');
    expect(knowledge[0].type).toBe('breaking_change');
  });

  test('ignores "breaking" used as an ordinary word', () => {
    // Regression: /BREAKING/i matched "breaking the build", turning bug fixes into
    // breaking changes. Two false positives appeared in the Next.js 15 notes.
    const knowledge = extract('### Bug Fixes\n\n- Fix a regression breaking the build on Windows');
    expect(knowledge.every((item) => item.type !== 'breaking_change')).toBe(true);
  });
});

describe('maintenance sections', () => {
  test('demotes claims under Bug Fixes', () => {
    // "Removed incorrect argument for NetworkError constructor" is a patch note,
    // not a critical API removal.
    const knowledge = extract('### Bug Fixes\n\n- Removed incorrect argument for NetworkError constructor');
    expect(knowledge[0]?.type).toBe('bug_fix');
  });

  test('but an explicit marker still escapes', () => {
    const knowledge = extract('### Bug Fixes\n\n- BREAKING CHANGE: `foo()` no longer accepts a callback');
    expect(knowledge[0].type).not.toBe('bug_fix');
  });
});

describe('conventional commits', () => {
  test('maps prefixes to types', () => {
    expect(extract('## Changes\n\n- fix(core): handle empty input')[0]?.type).toBe('bug_fix');
    expect(extract('## Breaking\n\n- feat(api)!: drop `legacy()`')[0]?.type).toBe('breaking_change');
  });
});

describe('claim content', () => {
  test('strips markdown links and PR references from titles', () => {
    const knowledge = extract('### Removed\n\n- Removed `foo()` [#4656](https://github.com/demo/demo/pull/4656)');
    expect(knowledge[0].title).not.toContain('http');
    expect(knowledge[0].title).not.toContain('#4656');
  });

  test('attaches the verbatim quote as evidence', () => {
    // Section 13 holds by construction: a claim without a quote cannot exist.
    const knowledge = extract('### Removed\n\n- `foo()` has been removed');
    expect(knowledge[0].sources[0].quotedText).toContain('has been removed');
  });

  test('pairs consecutive code fences as before/after', () => {
    const knowledge = extract(
      ['### Removed', '', '- `foo()` has been removed', '', '```ts', 'foo();', '```', '', '```ts', 'bar();', '```'].join('\n'),
    );

    expect(knowledge[0].migration[0]).toMatchObject({ kind: 'replace', before: 'foo();', after: 'bar();' });
  });

  test('downgrades a removal that names no symbol', () => {
    // "Removed unused imports" is internal; it must not drive a CRITICAL rating.
    const named = extract('### Removed\n\n- `foo()` has been removed')[0];
    const unnamed = extract('### Removed\n\n- Removed unused internal imports')[0];

    expect(named.severity).toBe('CRITICAL');
    expect(unnamed.severity).toBe('HIGH');
  });
});

describe('version anchoring', () => {
  test('prefers a version named in the heading', () => {
    const knowledge = extract('## v1.5.0\n\n### Removed\n\n- `foo()` has been removed');
    expect(knowledge[0].introduced).toBe('1.5.0');
    expect(knowledge[0].affected).toBe('>=1.5.0');
  });
});

describe('volume control', () => {
  test('caps claims per document, keeping the consequential ones', () => {
    // Next.js release notes carry hundreds of PR bullets; without a cap the index
    // fills with "fix: skip turbopack build test".
    const noise = Array.from({ length: 40 }, (_, index) => `- fix(core): patch number ${index}`).join('\n');
    const knowledge = extract(`### Removed\n\n- \`keepMe()\` has been removed\n\n### Bug Fixes\n\n${noise}`, {
      maxClaims: 5,
    });

    expect(knowledge).toHaveLength(5);
    expect(knowledge.some((item) => item.type === 'removed_api')).toBe(true);
  });
});
