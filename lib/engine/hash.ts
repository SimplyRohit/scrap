/**
 * Content hashing.
 *
 * Node-only: `node:crypto` is not available in the Convex runtime, so anything
 * importing this file must run in an action (`"use node"`), the CLI, or Next.js.
 * The pure text helpers that retrieval needs live in `text.ts`.
 */

import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function shortHash(input: string, length = 16): string {
  return sha256(input).slice(0, length);
}
