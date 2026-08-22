/**
 * Entry-point bootstrap: the one place optional providers get switched on.
 *
 * This is deliberately not done at import time. `bun` loads `.env.local`
 * automatically, so an import-time hook would give the test suite a live
 * embedding client and make it depend on the network and a paid key. Instead
 * every HTTP entry point calls this explicitly; anything importing the engine as
 * a library — tests included — gets the offline behaviour unless it opts in.
 */

import { configureEmbeddingsFromEnv } from './index/voyage';

let initialized = false;
let semantic = false;

/** Idempotent. Returns whether semantic retrieval is available. */
export function initializeEngine(): boolean {
  if (!initialized) {
    initialized = true;
    semantic = configureEmbeddingsFromEnv();
  }
  return semantic;
}
