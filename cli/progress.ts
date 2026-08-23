/**
 * Renders engine progress to stderr.
 *
 * stderr, never stdout: stdout carries `--json` and the MCP protocol framing,
 * and a spinner in either of those is corruption, not decoration.
 *
 * Two renderings, because a terminal and a log file want opposite things. On a
 * TTY one line is rewritten in place, so a long run occupies four lines instead
 * of four hundred. Everywhere else — a pipe, a CI job, a file — carriage
 * returns are noise, so each package gets one plain line and nothing is
 * overwritten.
 */

import { setProgressReporter, type ProgressEvent } from '../lib/engine/progress';
import { dim, green, riskColor } from './format';

/** Braille spinner. Advances on every event, so it moves when work happens. */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Longest line we will draw before trimming, when the width is unknown. */
const FALLBACK_WIDTH = 80;

function shorten(url: string): string {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean).slice(-2).join('/');
    return tail ? `${parsed.hostname}/${tail}` : parsed.hostname;
  } catch {
    return url;
  }
}

interface Live {
  frame: number;
  /** Cleared before every redraw, so a shorter line cannot leave a tail behind. */
  width: number;
}

function writeLive(state: Live, text: string): void {
  const room = Math.max(20, state.width - 1);
  const line = text.length > room ? `${text.slice(0, room - 1)}…` : text;
  process.stderr.write(`\r\x1b[2K${line}`);
}

function clearLive(): void {
  process.stderr.write('\r\x1b[2K');
}

/**
 * A TTY renderer: one line, rewritten.
 *
 * Every line is labelled from the event's own `package`, never from a
 * "currently running" variable. The manifest researches three packages at once,
 * so a single shared label printed mongoose's name above dotenv's changelog URL
 * — a progress display that lies about which package it is reading is worse
 * than no display, because it is the only thing telling you what is happening.
 *
 * Completed packages are printed above the live line, so the run leaves a
 * readable history rather than one line ending on whatever finished last.
 */
function ttyReporter(): (event: ProgressEvent) => void {
  const state: Live = { frame: 0, width: process.stderr.columns || FALLBACK_WIDTH };
  /** Per-package label, so a concurrent event can be rendered with its own. */
  const labels = new Map<string, string>();
  let total = 0;
  let done = 0;

  const label = (name: string) => labels.get(name) ?? name;
  const counter = () => (total > 1 ? dim(`[${done}/${total}] `) : '');

  const draw = (name: string, detail?: string) => {
    state.width = process.stderr.columns || FALLBACK_WIDTH;
    state.frame = (state.frame + 1) % FRAMES.length;
    writeLive(state, `${FRAMES[state.frame]} ${counter()}${label(name)}${detail ? ` ${dim(`· ${detail}`)}` : ''}`);
  };

  return (event) => {
    switch (event.kind) {
      case 'run-start':
        total = event.total;
        done = 0;
        break;

      case 'package-start':
        labels.set(event.package, event.package);
        draw(event.package);
        break;

      case 'package-target':
        labels.set(
          event.package,
          event.to ? `${event.package} ${dim(`${event.from} → ${event.to}`)}` : `${event.package} ${dim('already current')}`,
        );
        draw(event.package);
        break;

      case 'package-cached':
        draw(event.package, 'from the index');
        break;

      case 'source-start':
        draw(event.package, `reading ${shorten(event.url)}`);
        break;

      case 'source-done':
        draw(event.package, `${event.fromCache ? 'cached' : 'read'} ${shorten(event.url)} → ${event.extracted} claims`);
        break;

      case 'source-failed':
        draw(event.package, `skipped ${shorten(event.url)}`);
        break;

      case 'search':
        draw(event.package, `searching "${event.query}"`);
        break;

      case 'package-done': {
        done++;
        clearLive();
        const colour = riskColor(event.risk as Parameters<typeof riskColor>[0]);
        process.stderr.write(
          `  ${green('\u2713')} ${event.package} ${colour(event.risk)} ${dim(`${event.findings} findings`)}\n`,
        );
        labels.delete(event.package);
        break;
      }

      case 'run-done':
        clearLive();
        break;

      default:
        break;
    }
  };
}

/**
 * A non-TTY renderer: one plain line per package, no control characters.
 *
 * Source-level events are dropped. In a CI log they are hundreds of lines
 * nobody reads, and the thing that log has to answer is "did it get stuck", for
 * which one line per package is enough.
 */
function plainReporter(): (event: ProgressEvent) => void {
  return (event) => {
    switch (event.kind) {
      case 'run-start':
        process.stderr.write(`researching ${event.total} package(s)\n`);
        break;
      case 'package-start':
        process.stderr.write(`[${event.index}/${event.total}] ${event.package}\n`);
        break;
      case 'package-done':
        process.stderr.write(`          ${event.package} ${event.risk} · ${event.findings} findings\n`);
        break;
      default:
        break;
    }
  };
}

/**
 * Installs the renderer that suits this stderr, and returns a function that
 * removes it.
 *
 * `quiet` exists because a caller that has already decided to be silent — a
 * script reading `--json`, a harness capturing output — should not have to
 * discover that stderr is a TTY to get silence.
 */
export function startProgress(options: { quiet?: boolean } = {}): () => void {
  if (options.quiet || process.env.RIFT_NO_PROGRESS) return () => {};

  const interactive = Boolean(process.stderr.isTTY) && !process.env.CI;
  setProgressReporter(interactive ? ttyReporter() : plainReporter());

  return () => {
    if (interactive) clearLive();
    setProgressReporter(null);
  };
}
