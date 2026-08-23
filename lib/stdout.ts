/**
 * Writing to stdout without losing the tail.
 *
 * Two independent things truncate large output at exactly 64 KiB, the size of a
 * pipe buffer, and both of them stay invisible when you redirect to a file:
 *
 *   1. `process.stdout.write` only queues. `process.exit` discards the queue.
 *   2. Bun puts fd 1 in non-blocking mode when it is a pipe, so a synchronous
 *      write throws EAGAIN as soon as the reader falls behind.
 *
 * A CLI hit this on `--json | jq`; the MCP server hit it on any large tool
 * result, where a truncated line is a corrupted protocol frame rather than
 * merely a short answer.
 */

import { writeSync } from 'node:fs';

/** Blocks the thread. Only ever used to wait for a pipe reader to drain. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Writes the whole string to stdout before returning. Retries on EAGAIN. */
export function writeStdout(text: string): void {
  const payload = Buffer.from(text);
  let written = 0;

  while (written < payload.length) {
    try {
      written += writeSync(1, payload, written, payload.length - written);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') throw error;
      sleepSync(1);
    }
  }
}
