/**
 * Voyage AI embeddings (gen.md section 11, Phase 2).
 *
 * This is the only file in the engine that knows a specific embedding vendor
 * exists. It implements the `Embedder` seam and nothing else imports it except
 * the bootstrap, so swapping providers is a one-file change.
 *
 * Registration is explicit rather than automatic on import. Tests and offline
 * runs must never make a network call because an environment variable happened
 * to be present, so `configureEmbeddingsFromEnv()` has to be called by an entry
 * point that genuinely wants remote embeddings.
 */

import { registerEmbedder, type Embedder, type EmbeddingKind } from './embeddings';

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

/**
 * Output dimensions per model. Declared rather than discovered because the
 * store needs to know the width before the first call; a response of a
 * different width is treated as a configuration error.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  'voyage-3.5-lite': 1024,
  'voyage-3.5': 1024,
  'voyage-3-large': 1024,
  'voyage-code-3': 1024,
  'voyage-finance-2': 1024,
  'voyage-law-2': 1024,
};

const DEFAULT_MODEL = 'voyage-3.5-lite';

/**
 * Inputs per request. Voyage allows far more, but a smaller batch bounds the
 * blast radius of one failed request during a long backfill.
 */
const BATCH_SIZE = 96;

/**
 * Token ceiling per request. A key without a payment method on file is capped at
 * 10K tokens per minute, and a batch of 96 changelog entries blows straight
 * through that — the request is rejected whole, so the batch has to be sized to
 * the limit rather than retried into it.
 */
const DEFAULT_BATCH_TOKENS = 7_000;

/** Voyage bills by token; 4 characters per token is the usual English estimate
 * and only needs to be right enough to keep a batch under the ceiling. */
const CHARS_PER_TOKEN = 4;

/** Per-text ceiling. `truncation` handles the token limit server-side; this only
 * keeps request bodies from becoming absurd on a pathological source quote. */
const MAX_CHARS = 20_000;

const MAX_ATTEMPTS = 4;

/**
 * Backoff in milliseconds. Sub-second waits are useless against a limit measured
 * per minute: a free key allows 3 requests a minute, so the third attempt has to
 * be prepared to wait out most of one.
 */
const BACKOFF_MS = [2_000, 15_000, 60_000];

export interface VoyageOptions {
  apiKey: string;
  model?: string;
  /**
   * Client-side pacing. Set it below the account's limit and requests are spaced
   * out instead of being fired and rejected — far faster in wall-clock terms
   * than discovering the limit through 429s.
   */
  requestsPerMinute?: number;
  /** Token ceiling per request. Raise it on an account with standard limits. */
  batchTokens?: number;
  /** Injectable for tests. Narrower than `typeof fetch` on purpose — this is the
   * only shape the client uses, so a stub need not implement the rest. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  /** Overrides the backoff delay, so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

interface VoyageResponse {
  data?: { embedding?: number[]; index?: number }[];
  detail?: string;
  error?: { message?: string };
}

export class VoyageEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly batchTokens: number;
  private lastRequestAt = 0;

  constructor(options: VoyageOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.id = `voyage:${this.model}`;
    this.dimensions = MODEL_DIMENSIONS[this.model] ?? 1024;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.minIntervalMs = options.requestsPerMinute ? Math.ceil(60_000 / options.requestsPerMinute) : 0;
    this.batchTokens = options.batchTokens ?? DEFAULT_BATCH_TOKENS;
  }

  async embed(texts: string[], kind: EmbeddingKind = 'document'): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const batch of this.batches(texts)) {
      vectors.push(...(await this.embedBatch(batch, kind)));
    }
    return vectors;
  }

  /** Splits on whichever ceiling is reached first, count or tokens. */
  private *batches(texts: string[]): Generator<string[]> {
    let batch: string[] = [];
    let tokens = 0;

    for (const raw of texts) {
      const text = raw.slice(0, MAX_CHARS);
      const cost = Math.ceil(text.length / CHARS_PER_TOKEN);

      // A single oversized text still goes out alone: truncation is the
      // provider's job, and dropping it would silently lose the object.
      if (batch.length > 0 && (batch.length >= BATCH_SIZE || tokens + cost > this.batchTokens)) {
        yield batch;
        batch = [];
        tokens = 0;
      }

      batch.push(text);
      tokens += cost;
    }

    if (batch.length > 0) yield batch;
  }

  private async pace(): Promise<void> {
    if (this.minIntervalMs === 0) return;
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await this.sleep(wait);
  }

  private async embedBatch(batch: string[], kind: EmbeddingKind): Promise<number[][]> {
    const body = JSON.stringify({
      input: batch,
      model: this.model,
      input_type: kind,
      truncation: true,
    });

    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        await this.pace();
        this.lastRequestAt = Date.now();
        response = await this.fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body,
        });
      } catch (error) {
        // Network-level failure: retryable, and the message is worth keeping.
        lastError = error instanceof Error ? error.message : 'network error';
        if (attempt === MAX_ATTEMPTS) break;
        await this.sleep(backoff(attempt));
        continue;
      }

      if (response.ok) return parseVectors(await response.json(), batch.length, this.dimensions);

      const detail = await response.text().catch(() => '');
      lastError = `${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`;

      // 4xx other than rate limiting is a bad key or a bad request; retrying
      // just burns quota to get the same answer.
      if (!isRetryable(response.status) || attempt === MAX_ATTEMPTS) break;
      await this.sleep(retryDelay(response, attempt));
    }

    throw new Error(`Voyage embedding request failed: ${lastError}`);
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function backoff(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1];
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers?.get?.('retry-after');
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : backoff(attempt);
}

function parseVectors(payload: unknown, expected: number, dimensions: number): number[][] {
  const body = payload as VoyageResponse;
  const data = body?.data;
  if (!Array.isArray(data) || data.length !== expected) {
    throw new Error(`Voyage returned ${Array.isArray(data) ? data.length : 0} embeddings for ${expected} inputs`);
  }

  // The response carries an explicit index; ordering is not promised by position.
  const ordered: number[][] = new Array(expected);
  for (let position = 0; position < data.length; position++) {
    const entry = data[position];
    const index = typeof entry.index === 'number' ? entry.index : position;
    const vector = entry.embedding;
    if (!Array.isArray(vector) || vector.length !== dimensions) {
      throw new Error(`Voyage returned a ${vector?.length ?? 0}-dimension vector, expected ${dimensions}`);
    }
    ordered[index] = vector;
  }

  if (ordered.some((vector) => vector === undefined)) {
    throw new Error('Voyage response was missing an embedding for at least one input');
  }
  return ordered;
}

export function voyageConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

/**
 * Registers the Voyage embedder when a key is configured, and returns whether
 * semantic retrieval is now available. Idempotent, and safe to call from every
 * entry point.
 */
export function configureEmbeddingsFromEnv(): boolean {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return false;

  const rpm = Number(process.env.VOYAGE_RPM);
  registerEmbedder(
    new VoyageEmbedder({
      apiKey,
      model: process.env.VOYAGE_MODEL,
      requestsPerMinute: Number.isFinite(rpm) && rpm > 0 ? rpm : undefined,
      batchTokens: Number(process.env.VOYAGE_BATCH_TOKENS) || undefined,
    }),
  );
  return true;
}
