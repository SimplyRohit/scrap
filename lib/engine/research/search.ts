/**
 * Search layer (gen.md section 8).
 *
 * Search is used to *discover* authoritative URLs, never as a knowledge source in
 * itself — results are classified and then fetched through the normal source
 * pipeline so everything indexed still carries a real citation.
 */

import * as cheerio from 'cheerio';

import { brightDataError, tryFetchDocument } from './fetcher';
import { classifySource } from './sources';
import type { SourceType } from '../knowledge';
import { relayConfigured, relayPost } from '../relay';

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  sourceType: SourceType;
  rank: number;
}

const SERP_ENDPOINT = 'https://api.brightdata.com/request';

export function serpConfigured(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_KEY && (process.env.BRIGHTDATA_SERP_ZONE ?? process.env.BRIGHTDATA_ZONE));
}

/**
 * Bright Data SERP. Returns [] when unconfigured rather than throwing: search is
 * an enrichment step, and the deterministic sources (registry, releases,
 * changelog) must still produce a result without it.
 */
export async function searchWeb(query: string, limit = 10): Promise<SearchResult[]> {
  if (!serpConfigured()) return relayConfigured() ? searchViaRelay(query, limit) : [];

  const target = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}&brd_json=1`;

  try {
    const response = await fetch(SERP_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone: process.env.BRIGHTDATA_SERP_ZONE ?? process.env.BRIGHTDATA_ZONE,
        url: target,
        format: 'raw',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) return [];

    const reported = brightDataError(response.headers);
    if (reported) {
      warnOnce(`SERP zone rejected the request — ${reported}`);
      return [];
    }

    const body = await response.text();
    return parseSerp(body, limit);
  } catch {
    return [];
  }
}

/**
 * Reports a broken SERP configuration exactly once per process.
 *
 * Returning `[]` stays the contract — discovery is enrichment, and the
 * deterministic sources must still produce a result without it. But an empty
 * result from a misconfigured zone is indistinguishable from an empty result
 * from a genuinely obscure query, and that ambiguity is what let a wrong zone
 * name go unnoticed while every answer quietly rested on a single domain.
 *
 * Once, not per query: a research run issues several searches, and three
 * identical warnings about one broken zone is noise that trains you to skip it.
 */
const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  process.stderr.write(`warning  ${message}\n`);
}

/** Test seam: the set outlives a single test otherwise. */
export function resetSearchWarnings(): void {
  warned.clear();
}

/**
 * Discovery through the deployed site's SERP zone.
 *
 * The relay returns already-parsed results, so `sourceType` is reclassified
 * here rather than trusted: authority tier decides how much a claim is worth,
 * and that judgement belongs to the machine doing the extracting.
 */
async function searchViaRelay(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const body = await relayPost<{ results?: Array<{ url?: string; title?: string; snippet?: string }> }>(
      '/api/relay/search',
      { query, limit },
    );

    return (body.results ?? [])
      .filter((item): item is { url: string; title?: string; snippet?: string } => Boolean(item.url))
      .slice(0, limit)
      .map((item, index) => ({
        url: item.url,
        title: item.title ?? '',
        snippet: item.snippet ?? '',
        sourceType: classifySource(item.url),
        rank: index,
      }));
  } catch {
    return [];
  }
}

/** Handles both `brd_json=1` structured output and raw SERP HTML. */
function parseSerp(body: string, limit: number): SearchResult[] {
  try {
    const json = JSON.parse(body) as { organic?: Array<{ link?: string; title?: string; description?: string }> };
    if (json.organic) {
      return json.organic
        .filter((item) => item.link)
        .slice(0, limit)
        .map((item, index) => ({
          url: item.link!,
          title: item.title ?? '',
          snippet: item.description ?? '',
          sourceType: classifySource(item.link!),
          rank: index,
        }));
    }
  } catch {
    // Raw HTML SERP — fall through.
  }

  const $ = cheerio.load(body);
  const results: SearchResult[] = [];

  $('a[href^="/url?q="], a[href^="http"]').each((_, element) => {
    if (results.length >= limit) return;

    const raw = $(element).attr('href') ?? '';
    const url = raw.startsWith('/url?q=') ? decodeURIComponent(raw.slice(7).split('&')[0]) : raw;
    if (!/^https?:\/\//.test(url)) return;
    if (/google\.com|gstatic\.com|googleusercontent/.test(url)) return;
    if (results.some((result) => result.url === url)) return;

    const title = $(element).find('h3').first().text() || $(element).text().trim().slice(0, 120);
    if (!title) return;

    results.push({ url, title, snippet: '', sourceType: classifySource(url), rank: results.length });
  });

  return results;
}

/**
 * The multi-angle query set from gen.md section 8. Callers run these in priority
 * order and stop once retrieval confidence is sufficient.
 */
export function buildErrorQueries(input: {
  package: string;
  version?: string;
  previousVersion?: string;
  errorType: string;
  normalizedMessage: string;
  repoSlug?: string;
  docsDomain?: string;
}): Array<{ label: string; query: string }> {
  const { package: pkg, version, previousVersion, errorType, normalizedMessage, repoSlug, docsDomain } = input;
  const message = normalizedMessage.slice(0, 120);
  const queries: Array<{ label: string; query: string }> = [
    { label: 'exact', query: `"${errorType}" "${message}"` },
    { label: 'normalized', query: `${pkg} "${errorType}" ${message}` },
  ];

  if (version) queries.push({ label: 'version-specific', query: `${pkg} ${version} "${errorType}"` });
  if (previousVersion && version) {
    queries.push({ label: 'migration-specific', query: `${pkg} ${previousVersion} to ${version} "${errorType}"` });
  }
  if (repoSlug) queries.push({ label: 'github', query: `site:github.com/${repoSlug} "${errorType}"` });
  if (docsDomain) queries.push({ label: 'documentation', query: `site:${docsDomain} "${errorType}"` });

  return queries;
}

/** Discovery queries for an upgrade (gen.md section 5 priority ladder). */
export function buildUpgradeQueries(pkg: string, fromVersion: string, toVersion: string): Array<{ label: string; query: string }> {
  const fromMajor = fromVersion.split('.')[0];
  const toMajor = toVersion.split('.')[0];

  return [
    { label: 'migration-guide', query: `${pkg} ${fromMajor} to ${toMajor} migration guide` },
    { label: 'breaking-changes', query: `${pkg} ${toVersion} breaking changes` },
    { label: 'upgrade-guide', query: `${pkg} upgrade guide ${toMajor}` },
  ];
}

/** Fetches a discovered result's body so it can be normalized like any other source. */
export async function fetchSearchResult(result: SearchResult, refresh = false) {
  return tryFetchDocument(result.url, { sourceType: result.sourceType, refresh });
}
