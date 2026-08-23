/**
 * The editor's pure half: what the text in the field currently is, and what a
 * tidied version of it would look like.
 *
 * Kept out of the component so it can be tested without rendering anything, and
 * because the interesting part — turning a parser complaint into a line number —
 * is logic rather than markup.
 */

import { parseManifest } from './engine/ingestion/manifest';

export type EditorStatus =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'valid'; ecosystem: string; packages: number };

/**
 * Reads the manifest the way the backend will.
 *
 * `parseManifest` is the same function the research pipeline calls, and it is
 * pure, so the browser can run it. That matters more than it sounds: it never
 * throws on malformed JSON — it falls through to the line parser — so a missing
 * brace produced a confident analysis of nothing. Checking the JSON separately
 * is what turns that into a message.
 */
export function inspectManifest(content: string, fileName: string): EditorStatus {
  const trimmed = content.trim();
  if (!trimmed) return { kind: 'empty' };

  if (trimmed.startsWith('{')) {
    try {
      JSON.parse(trimmed);
    } catch (error) {
      return { kind: 'invalid', message: describeJsonError(error, trimmed) };
    }
  }

  const parsed = parseManifest(content, fileName);

  return { kind: 'valid', ecosystem: parsed.ecosystem, packages: parsed.totalCount };
}

/**
 * Turns a parser error into a line number.
 *
 * Engines disagree about how to say where it broke. Recent V8 names the line
 * outright; older V8 gives a character offset, which is useless against a field
 * you are looking at; Safari gives neither. Each case degrades to the next.
 */
export function describeJsonError(error: unknown, source: string): string {
  const message = error instanceof Error ? error.message : '';

  const named = /line (\d+)/i.exec(message);
  if (named) return `Invalid JSON · line ${named[1]}`;

  const offset = /position (\d+)/i.exec(message);
  if (offset) return `Invalid JSON · line ${source.slice(0, Number(offset[1])).split('\n').length}`;

  return 'Invalid JSON';
}

/** Pretty-prints JSON; for everything else, tidies whitespace without reordering. */
export function formatManifest(content: string): string {
  const trimmed = content.trim();

  if (trimmed.startsWith('{')) {
    try {
      return `${JSON.stringify(JSON.parse(trimmed), null, 2)}\n`;
    } catch {
      // Nothing to format in something that does not parse.
      return content;
    }
  }

  // Requirements files carry meaning in their order and their comments, so this
  // only removes trailing space and collapses runs of blank lines.
  return `${trimmed
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')}\n`;
}
