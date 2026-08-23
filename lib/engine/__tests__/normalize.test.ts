import { describe, expect, test } from 'bun:test';

import { normalizeDocument, parseMarkdown } from '../analysis/normalize';

describe('parseMarkdown', () => {
  test('parses CRLF documents', () => {
    // Regression: GitHub release bodies are CRLF, and `.` does not match `\r`, so
    // every `$`-anchored heading and bullet pattern silently failed. The whole
    // document collapsed into one empty section and extraction returned nothing.
    const document = parseMarkdown('### Removed\r\n\r\n- `foo()` was removed\r\n- `bar()` was removed\r\n');

    expect(document.sections).toHaveLength(1);
    expect(document.sections[0].heading).toBe('Removed');
    expect(document.sections[0].bullets).toEqual(['`foo()` was removed', '`bar()` was removed']);
  });

  test('tracks the heading trail so claims keep their context', () => {
    const document = parseMarkdown(['# v2.0.0', '## Breaking changes', '### Removed', '- `foo()` is gone'].join('\n'));

    const section = document.sections.find((item) => item.heading === 'Removed');
    expect(section?.headingTrail).toEqual(['v2.0.0', 'Breaking changes']);
    expect(section?.level).toBe(3);
  });

  test('captures fenced code with its language', () => {
    const document = parseMarkdown(['## Migrate', '', '```ts', 'const x = 1;', '```'].join('\n'));

    expect(document.sections[0].codeBlocks).toEqual([{ language: 'ts', code: 'const x = 1;' }]);
  });

  test('does not treat fenced content as headings or bullets', () => {
    const document = parseMarkdown(['## Example', '', '```sh', '# not a heading', '- not a bullet', '```'].join('\n'));

    expect(document.sections).toHaveLength(1);
    expect(document.sections[0].bullets).toEqual([]);
  });

  test('assigns anchors for citation deep-links', () => {
    const document = parseMarkdown('## Breaking Changes!\n\ntext');
    expect(document.sections[0].anchor).toBe('breaking-changes');
  });
});

describe('normalizeDocument', () => {
  test('extracts prose from HTML and drops navigation chrome', () => {
    const html = `
      <html><body>
        <nav><a href="/x">Docs</a></nav>
        <main>
          <h2>Removed</h2>
          <ul><li>The <code>foo()</code> helper was removed</li></ul>
          <pre><code class="language-ts">bar()</code></pre>
        </main>
        <footer>copyright</footer>
      </body></html>`;

    const document = normalizeDocument(html, 'text/html');

    expect(document.sections[0].heading).toBe('Removed');
    expect(document.sections[0].bullets[0]).toContain('was removed');
    expect(document.sections[0].codeBlocks[0]).toMatchObject({ language: 'ts', code: 'bar()' });
    expect(document.text).not.toContain('copyright');
  });

  test('treats markdown content types as markdown even when they contain tags', () => {
    const document = normalizeDocument('## Notes\n\n- uses <div> in prose', 'text/markdown');
    expect(document.sections[0].heading).toBe('Notes');
  });
});

describe('nested bullets', () => {
  test('a nested bullet qualifies its parent instead of becoming a peer claim', () => {
    // Real chalk 5.0.0 release notes. Flattened, "you need TypeScript 4.7"
    // became a breaking change in its own right and outranked the change it was
    // qualifying when a diagnosis went looking for a cause.
    const { sections } = parseMarkdown(`### Breaking

- **This package is now pure ESM.**
\t- If you use TypeScript, you need to use TypeScript 4.7 or later.
  - If you use a bundler, make sure it supports ESM.
- Require Node.js 12.20
`);

    const breaking = sections.find((section) => section.heading === 'Breaking');
    expect(breaking?.bullets).toHaveLength(2);
    expect(breaking?.bullets[0]).toContain('pure ESM');
    expect(breaking?.bullets[0]).toContain('TypeScript 4.7');
    expect(breaking?.bullets[0]).toContain('supports ESM');
    expect(breaking?.bullets[1]).toBe('Require Node.js 12.20');
  });

  test('a flat list is still a list', () => {
    const { sections } = parseMarkdown(`### Removed

- \`foo()\`
- \`bar()\`
`);

    expect(sections.find((section) => section.heading === 'Removed')?.bullets).toEqual(['`foo()`', '`bar()`']);
  });
});
