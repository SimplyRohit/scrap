/**
 * GitHub research (gen.md section 5, priorities 4-6).
 *
 * Release notes are the highest-yield structured source for breaking changes:
 * they are authored per version, so knowledge extracted from them inherits an
 * exact version anchor without inference.
 */

import { fetchDocument, tryFetchDocument } from './fetcher';
import { coerce, gt, compareStrings, parse } from '../semver';

export interface GitHubRelease {
  tagName: string;
  version: string;
  name: string;
  body: string;
  publishedAt?: string;
  htmlUrl: string;
  prerelease: boolean;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  htmlUrl: string;
  createdAt?: string;
  closedAt?: string;
  labels: string[];
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

/**
 * The GitHub REST client goes through `fetchDocument` for caching, but needs auth
 * headers the generic fetcher does not carry, so authenticated calls bypass it.
 * Unauthenticated calls (the common case) stay cached.
 */
async function githubJson<T>(url: string, refresh: boolean): Promise<T | null> {
  if (process.env.GITHUB_TOKEN) {
    const response = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  }

  const document = await tryFetchDocument(url, { sourceType: 'official_release', refresh, transport: 'direct' });
  if (!document) return null;
  try {
    return JSON.parse(document.body) as T;
  } catch {
    return null;
  }
}

interface RawRelease {
  tag_name: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

function toRelease(raw: RawRelease): GitHubRelease {
  return {
    tagName: raw.tag_name,
    version: coerce(raw.tag_name.replace(/^[^\d]*/, '')),
    name: raw.name || raw.tag_name,
    body: raw.body ?? '',
    publishedAt: raw.published_at,
    htmlUrl: raw.html_url,
    prerelease: raw.prerelease,
  };
}

export async function listReleases(slug: string, refresh = false, pages = 2): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];

  for (let page = 1; page <= pages; page++) {
    const raw = await githubJson<RawRelease[]>(
      `https://api.github.com/repos/${slug}/releases?per_page=100&page=${page}`,
      refresh,
    );
    if (!raw || raw.length === 0) break;
    releases.push(...raw.filter((release) => !release.draft).map(toRelease));
    if (raw.length < 100) break;
  }

  return releases;
}

/**
 * Releases strictly after `fromVersion` through `toVersion` — the exact set of
 * notes that can contain changes affecting this upgrade.
 */
export async function releasesInWindow(
  slug: string,
  fromVersion: string,
  toVersion: string,
  refresh = false,
): Promise<GitHubRelease[]> {
  const releases = await listReleases(slug, refresh);

  return releases
    .filter((release) => {
      if (!release.version) return false;
      if (release.prerelease) return false;
      return gt(release.version, fromVersion) && compareStrings(release.version, toVersion) <= 0;
    })
    .sort((a, b) => compareStrings(a.version, b.version));
}

/**
 * Picks which releases to spend the document budget on.
 *
 * Chronological order is the wrong default: for 0.27 -> 1.19, the first N
 * releases are patch notes and the breaking changes live in 1.0.0. Major
 * boundaries and the target release come first, then the most recent, then the
 * rest — so a small budget still lands on the releases that can break you.
 */
export function prioritizeReleases(releases: GitHubRelease[], toVersion: string, limit: number): GitHubRelease[] {
  const rank = (release: GitHubRelease): number => {
    // Two-part tags like `v2.0` are common and must still rank as major boundaries.
    const version = parse(coerce(release.version));
    if (!version) return 4;
    if (release.version === toVersion) return 0;
    // A 0.x line has no majors, so its minor bumps are the breaking boundaries.
    if (version.major > 0 && version.minor === 0 && version.patch === 0) return 1;
    if (version.major === 0 && version.patch === 0) return 2;
    return 3;
  };

  return [...releases]
    .sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return compareStrings(b.version, a.version); // newer first within a rank
    })
    .slice(0, limit)
    .sort((a, b) => compareStrings(a.version, b.version)); // process oldest to newest
}

/** Falls back to a single tagged release when the window is empty or unresolvable. */
export async function releaseForTag(
  slug: string,
  version: string,
  refresh = false,
  packageName?: string,
): Promise<GitHubRelease | null> {
  for (const tag of tagCandidates(version, packageName)) {
    const raw = await githubJson<RawRelease>(
      `https://api.github.com/repos/${slug}/releases/tags/${encodeURIComponent(tag)}`,
      refresh,
    );
    if (raw) return toRelease(raw);
  }
  return null;
}

interface RawIssueSearch {
  items?: Array<{
    number: number;
    title: string;
    body?: string;
    state: string;
    html_url: string;
    created_at?: string;
    closed_at?: string;
    labels?: Array<{ name: string }>;
  }>;
}

/** Issue search scoped to the package's own repository (gen.md section 8, search 5). */
export async function searchIssues(slug: string, query: string, refresh = false, limit = 8): Promise<GitHubIssue[]> {
  const search = `repo:${slug} ${query} in:title,body`;
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(search)}&per_page=${limit}`;

  const raw = await githubJson<RawIssueSearch>(url, refresh);
  if (!raw?.items) return [];

  return raw.items.map((item) => ({
    number: item.number,
    title: item.title,
    body: item.body ?? '',
    state: item.state,
    htmlUrl: item.html_url,
    createdAt: item.created_at,
    closedAt: item.closed_at,
    labels: (item.labels ?? []).map((label) => label.name),
  }));
}

/**
 * The repository's real default branch.
 *
 * `main` and `master` cover most repositories and miss the rest — `trunk`,
 * `develop`, `next`, and anything else a project chose. Guessing means every
 * in-repo changelog probe 404s silently and the package looks undocumented. The
 * API states the answer, so ask once and cache it.
 */
export async function defaultBranch(slug: string, refresh = false): Promise<string | null> {
  const repository = await githubJson<{ default_branch?: string }>(
    `https://api.github.com/repos/${slug}`,
    refresh,
  );
  return repository?.default_branch ?? null;
}

/**
 * Branches to probe, best first.
 *
 * The known default leads. `main` and `master` stay as fallbacks because the API
 * call can fail — no token means 60 requests an hour, and a rate-limited lookup
 * must not take the whole changelog probe down with it.
 */
export function branchCandidates(known?: string | null): string[] {
  return [...new Set([known, 'main', 'master'].filter((branch): branch is string => Boolean(branch)))];
}

/**
 * Tag spellings a release may use, best first.
 *
 * `v1.2.3` and `1.2.3` are both common. Monorepos published with changesets or
 * Lerna tag as `package@1.2.3`, which neither of the other two forms finds.
 */
export function tagCandidates(version: string, packageName?: string): string[] {
  const tags = [`v${version}`, version];
  if (packageName) {
    tags.push(`${packageName}@${version}`);
    const unscoped = packageName.replace(/^@[^/]+\//, '');
    if (unscoped !== packageName) tags.push(`${unscoped}@${version}`);
  }
  return [...new Set(tags)];
}

/** Raw file from the default branch, used for CHANGELOG and migration docs in-repo. */
export async function fetchRepoFile(
  slug: string,
  filePath: string,
  refresh = false,
  branch?: string | null,
): Promise<string | null> {
  for (const candidate of branchCandidates(branch)) {
    const document = await tryFetchDocument(
      `https://raw.githubusercontent.com/${slug}/${candidate}/${filePath}`,
      { sourceType: 'official_changelog', refresh, transport: 'direct' },
    );
    if (document) return document.body;
  }
  return null;
}

export async function fetchReleaseBodyOrThrow(
  slug: string,
  version: string,
  packageName?: string,
): Promise<string> {
  const release = await releaseForTag(slug, version, false, packageName);
  if (release) return release.body;

  // The API found nothing, so fall back to the HTML page — and try each tag
  // spelling there too, since the API and the page agree on the tag name.
  let lastError: unknown;
  for (const tag of tagCandidates(version, packageName)) {
    try {
      const document = await fetchDocument(`https://github.com/${slug}/releases/tag/${tag}`, {
        sourceType: 'official_release',
      });
      return document.body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No release page for ${slug} ${version}`);
}
