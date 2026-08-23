import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * On-disk root for the knowledge index and fetch cache.
 *
 * Filesystem-backed by design for Phase 1: it is inspectable, diffable, and has no
 * service to stand up. `store.ts` isolates persistence behind an interface so
 * Phase 2 can swap in Postgres/pgvector without touching the pipeline.
 *
 * Resolved per call rather than once at import. A constant is read before any
 * caller can set `UPGRADE_INTEL_DATA_DIR`, which silently ignored the variable
 * in tests and left a long-running process unable to be pointed anywhere else.
 */
export function homeRoot(): string {
  return path.join(homedir(), '.upgrade-intel');
}

/**
 * Resolution order, most specific first:
 *
 *   1. `UPGRADE_INTEL_DATA_DIR` — an explicit instruction always wins.
 *   2. `./.upgrade-intel`, but only if it already exists. A project opts in by
 *      creating it; the directory is never created here, so merely running the
 *      CLI somewhere does not fork the index.
 *   3. `~/.upgrade-intel` — the default.
 *
 * The home default is the important one. What is indexed is knowledge about
 * *packages*, not about a repository, so an agent that learns why chalk 5 throws
 * in one project must not start from nothing in the next. Keying the index to
 * the working directory made every new repository a cold start.
 */
export function dataRoot(): string {
  const explicit = process.env.UPGRADE_INTEL_DATA_DIR;
  if (explicit) return explicit;

  const local = path.join(process.cwd(), '.upgrade-intel');
  return existsSync(local) ? local : homeRoot();
}

export function cacheDir(): string {
  return path.join(dataRoot(), 'cache');
}

export function indexFile(): string {
  return path.join(dataRoot(), 'index.json');
}

export function sourcesDir(): string {
  return path.join(dataRoot(), 'sources');
}

/** Credentials for a globally installed CLI, which has no project `.env.local`. */
export function homeEnvFile(): string {
  return path.join(homeRoot(), '.env');
}

export async function ensureDataDirs(): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  await mkdir(sourcesDir(), { recursive: true });
}
