/**
 * Progress reporting seam.
 *
 * `rift repo .` on five backend packages takes about 105 seconds and printed
 * nothing at all until it was done. It was reading six real documents per
 * package the whole time, but silence and a hang look identical from the
 * outside, so the honest reading of that output was "this is broken".
 *
 * The engine reports what it is doing; deciding whether anyone sees it belongs
 * to the entry point. Nothing here writes to a stream — a library that printed
 * on its own would corrupt `--json` on stdout and the MCP framing with it.
 *
 * No reporter is installed by default. An engine imported as a library stays
 * silent, the same way embeddings and the relay stay off until asked for.
 */

export type ProgressEvent =
  /** A manifest run began. `total` packages will be researched. */
  | { kind: 'run-start'; total: number }
  /** One package began. `index` is 1-based, `total` matches `run-start`. */
  | { kind: 'package-start'; package: string; index: number; total: number }
  /** The version window was resolved, or found to be unnecessary. */
  | { kind: 'package-target'; package: string; from: string; to: string | null }
  /** The index already covered this window, so nothing was fetched. */
  | { kind: 'package-cached'; package: string }
  /** A source is about to be read. `planned` is how many are queued. */
  | { kind: 'source-start'; package: string; url: string; planned: number }
  /** A source was read. `extracted` claims came out of it. */
  | { kind: 'source-done'; package: string; url: string; extracted: number; fromCache: boolean }
  /** A source could not be read. Expected for speculative URLs. */
  | { kind: 'source-failed'; package: string; url: string; reason: string }
  /** Web discovery ran because the planned sources were not enough. */
  | { kind: 'search'; package: string; query: string }
  /** One package finished. */
  | { kind: 'package-done'; package: string; risk: string; findings: number }
  /** The whole run finished. */
  | { kind: 'run-done'; total: number };

export type ProgressReporter = (event: ProgressEvent) => void;

/**
 * Held on `globalThis` rather than in module scope.
 *
 * Bundling this CLI for Node emits a second, partial copy of small modules for
 * the symbols the entry file imports directly. A reporter installed through one
 * copy was invisible to the engine reading the other — the same fault that made
 * `rift stats` report every capability `off` while the relay worked. A
 * `Symbol.for` key is the one identity a bundler cannot fork.
 */
const REPORTER_KEY = Symbol.for('rift.progress.reporter');

type Host = Record<symbol, ProgressReporter | null | undefined>;

/** Installs a reporter, or clears it with `null`. */
export function setProgressReporter(reporter: ProgressReporter | null): void {
  (globalThis as unknown as Host)[REPORTER_KEY] = reporter;
}

/**
 * Emits an event to whatever reporter is installed.
 *
 * Never throws. A broken renderer must not be able to fail a research run that
 * is otherwise working — progress is a courtesy, and the report is the product.
 */
export function reportProgress(event: ProgressEvent): void {
  const reporter = (globalThis as unknown as Host)[REPORTER_KEY];
  if (!reporter) return;
  try {
    reporter(event);
  } catch {
    // A renderer that cannot render is not a reason to lose the research.
  }
}
