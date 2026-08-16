import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * On-disk root for the knowledge index and fetch cache.
 *
 * Filesystem-backed by design for Phase 1: it is inspectable, diffable, and has no
 * service to stand up. `store.ts` isolates persistence behind an interface so
 * Phase 2 can swap in Postgres/pgvector without touching the pipeline.
 */
export const DATA_ROOT = process.env.UPGRADE_INTEL_DATA_DIR ?? path.join(process.cwd(), '.upgrade-intel');

export const CACHE_DIR = path.join(DATA_ROOT, 'cache');
export const INDEX_FILE = path.join(DATA_ROOT, 'index.json');
export const SOURCES_DIR = path.join(DATA_ROOT, 'sources');

export async function ensureDataDirs(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(SOURCES_DIR, { recursive: true });
}
