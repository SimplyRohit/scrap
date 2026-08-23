/**
 * Entry-point bootstrap: the one place optional providers get switched on.
 *
 * This is deliberately not done at import time. `bun` loads `.env.local`
 * automatically, so an import-time hook would give the test suite a live
 * embedding client and make it depend on the network and a paid key. Instead
 * every HTTP entry point calls this explicitly; anything importing the engine as
 * a library — tests included — gets the offline behaviour unless it opts in.
 */

import { readFileSync } from 'node:fs';

import { configureEmbeddingsFromRelay } from './index/relayEmbedder';
import { configureEmbeddingsFromEnv } from './index/voyage';
import { homeEnvFile } from './paths';

let initialized = false;
let semantic = false;

/**
 * Loads `~/.upgrade-intel/.env`.
 *
 * `bun` reads `.env.local` from the working directory, which is exactly wrong
 * for a globally installed CLI: an agent runs it inside *its* repository, so the
 * keys sit in a project it will never be invoked from. Every capability reported
 * `off` and every answer came back empty, with nothing to say why.
 *
 * The real environment always wins — this only fills gaps, so CI and a shell
 * export keep behaving the way they read.
 */
function loadHomeEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(homeEnvFile(), 'utf8');
  } catch {
    return;
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (process.env[key] !== undefined) continue;

    const raw = trimmed.slice(separator + 1).trim();
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
}

/**
 * Idempotent. Returns whether semantic retrieval is available.
 *
 * A local key is tried first and the relay only fills the gap, so a caller who
 * pays for Voyage keeps their own quota, their own model choice, and their own
 * vectors. Switching between the two changes the embedder id, which the store
 * treats as a different coordinate space — that is correct, and it is why the
 * order here is fixed rather than whichever answers first.
 */
export function initializeEngine(): boolean {
  if (!initialized) {
    initialized = true;
    loadHomeEnv();
    semantic = configureEmbeddingsFromEnv() || configureEmbeddingsFromRelay();
  }
  return semantic;
}
