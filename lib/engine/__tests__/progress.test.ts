/**
 * Progress reporting.
 *
 * The property that matters is not what the events say — it is that nothing
 * about them can break a research run. A silent engine looks broken; an engine
 * that fails because its spinner threw is worse than the silence was.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { reportProgress, setProgressReporter, type ProgressEvent } from '../progress';

afterEach(() => setProgressReporter(null));
beforeEach(() => setProgressReporter(null));

function collect(): ProgressEvent[] {
  const seen: ProgressEvent[] = [];
  setProgressReporter((event) => seen.push(event));
  return seen;
}

describe('reportProgress', () => {
  test('delivers to an installed reporter', () => {
    const seen = collect();
    reportProgress({ kind: 'run-start', total: 3 });
    expect(seen).toEqual([{ kind: 'run-start', total: 3 }]);
  });

  /**
   * The default. An engine imported as a library must not print, the same way
   * embeddings and the relay stay off until an entry point asks for them.
   */
  test('is a no-op with no reporter installed', () => {
    expect(() => reportProgress({ kind: 'run-done', total: 1 })).not.toThrow();
  });

  test('a reporter can be removed', () => {
    const seen = collect();
    setProgressReporter(null);
    reportProgress({ kind: 'run-done', total: 1 });
    expect(seen).toHaveLength(0);
  });

  /**
   * Progress is a courtesy; the report is the product. A renderer that cannot
   * render — a closed stream, a terminal that went away mid-run — must not take
   * the research down with it.
   */
  test('a throwing reporter does not propagate', () => {
    setProgressReporter(() => {
      throw new Error('stderr closed');
    });
    expect(() => reportProgress({ kind: 'run-start', total: 1 })).not.toThrow();
  });

  /**
   * The state lives on globalThis under a `Symbol.for` key, because bundling
   * emits duplicate copies of small modules and a reporter installed through
   * one copy was invisible to the engine reading the other.
   */
  test('the reporter is shared through the global registry', () => {
    const seen = collect();
    const host = globalThis as unknown as Record<symbol, unknown>;
    expect(host[Symbol.for('rift.progress.reporter')]).toBeDefined();

    reportProgress({ kind: 'package-done', package: 'chalk', risk: 'HIGH', findings: 4 });
    expect(seen).toHaveLength(1);
  });
});
