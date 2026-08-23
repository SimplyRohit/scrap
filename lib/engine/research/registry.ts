/**
 * Package registry clients (gen.md section 3: "compare against latest available version").
 *
 * The registry is the authority on which versions exist and where a package's
 * source and docs live. Every downstream source URL is derived from here rather
 * than from a hardcoded table, so the engine works for packages nobody enumerated.
 */

import { fetchDocument, tryFetchDocument } from './fetcher';
import { branchCandidates } from './github';
import { compareStrings, parse, sortVersionsAscending } from '../semver';
import type { Ecosystem } from '../knowledge';

export interface PackageMetadata {
  name: string;
  ecosystem: Ecosystem;
  latestVersion: string | null;
  versions: string[];
  repositoryUrl?: string;
  /** `owner/repo` when the repository is on GitHub. */
  githubSlug?: string;
  homepage?: string;
  documentationUrl?: string;
  changelogUrl?: string;
  description?: string;
  deprecated?: string;
  registryUrl: string;
}

function isPythonEcosystem(ecosystem: Ecosystem): boolean {
  return ecosystem !== 'nodejs';
}

export function githubSlugFrom(url?: string): string | undefined {
  if (!url) return undefined;
  const match = /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/i.exec(url);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** Drops prereleases unless the package has published nothing else. */
function stableVersions(versions: string[]): string[] {
  const stable = versions.filter((v) => (parse(v)?.prerelease.length ?? 1) === 0);
  return stable.length > 0 ? stable : versions;
}

interface NpmPackument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, unknown>;
  time?: Record<string, string>;
  repository?: string | { url?: string };
  homepage?: string;
  description?: string;
  deprecated?: string;
}

async function fetchNpmMetadata(name: string, ecosystem: Ecosystem, refresh: boolean): Promise<PackageMetadata> {
  const registryUrl = `https://registry.npmjs.org/${name.replace(/\//g, '%2F')}`;
  const document = await fetchDocument(registryUrl, {
    sourceType: 'package_registry',
    refresh,
    transport: 'direct',
  });

  const packument = JSON.parse(document.body) as NpmPackument;
  const versions = sortVersionsAscending(Object.keys(packument.versions ?? {}));
  const repositoryUrl =
    typeof packument.repository === 'string' ? packument.repository : packument.repository?.url;
  const githubSlug = githubSlugFrom(repositoryUrl) ?? githubSlugFrom(packument.homepage);

  return {
    name,
    ecosystem,
    latestVersion: packument['dist-tags']?.latest ?? stableVersions(versions).at(-1) ?? null,
    versions,
    repositoryUrl: repositoryUrl?.replace(/^git\+/, '').replace(/\.git$/, ''),
    githubSlug,
    homepage: packument.homepage,
    description: packument.description,
    deprecated: packument.deprecated,
    registryUrl: `https://www.npmjs.com/package/${name}`,
  };
}

interface PyPiResponse {
  info?: {
    version?: string;
    home_page?: string;
    project_url?: string;
    project_urls?: Record<string, string>;
    summary?: string;
    yanked_reason?: string;
    docs_url?: string;
  };
  releases?: Record<string, unknown[]>;
}

async function fetchPyPiMetadata(name: string, ecosystem: Ecosystem, refresh: boolean): Promise<PackageMetadata> {
  const registryUrl = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  const document = await fetchDocument(registryUrl, {
    sourceType: 'package_registry',
    refresh,
    transport: 'direct',
  });

  const payload = JSON.parse(document.body) as PyPiResponse;
  const info = payload.info ?? {};
  const projectUrls = info.project_urls ?? {};

  // PyPI's project_urls keys are author-chosen; match on intent, not exact label.
  const findUrl = (pattern: RegExp): string | undefined => {
    const hit = Object.entries(projectUrls).find(([label]) => pattern.test(label));
    return hit?.[1];
  };

  const repositoryUrl = findUrl(/source|repository|code|github/i) ?? info.home_page;
  const versions = sortVersionsAscending(
    Object.keys(payload.releases ?? {}).filter((version) => parse(version) !== null),
  );

  return {
    name,
    ecosystem,
    latestVersion: info.version ?? stableVersions(versions).at(-1) ?? null,
    versions,
    repositoryUrl,
    githubSlug: githubSlugFrom(repositoryUrl) ?? githubSlugFrom(findUrl(/.*/)),
    homepage: info.home_page ?? info.project_url,
    documentationUrl: findUrl(/doc/i) ?? info.docs_url,
    changelogUrl: findUrl(/changelog|changes|release/i),
    description: info.summary,
    deprecated: info.yanked_reason ?? undefined,
    registryUrl: `https://pypi.org/project/${name}/`,
  };
}

export async function fetchPackageMetadata(
  name: string,
  ecosystem: Ecosystem,
  refresh = false,
): Promise<PackageMetadata> {
  // The default branch is deliberately not resolved here. A metadata lookup runs
  // on the index-first path too, and that path must cost one request. It is
  // resolved by whoever is about to probe the repository — see `resolveSourcePlan`.
  return isPythonEcosystem(ecosystem)
    ? fetchPyPiMetadata(name, ecosystem, refresh)
    : fetchNpmMetadata(name, ecosystem, refresh);
}

/** Registry lookup that degrades to a metadata stub rather than failing the run. */
export async function tryFetchPackageMetadata(
  name: string,
  ecosystem: Ecosystem,
  refresh = false,
): Promise<PackageMetadata | null> {
  try {
    return await fetchPackageMetadata(name, ecosystem, refresh);
  } catch {
    return null;
  }
}

export type TargetPolicy = 'latest' | 'latest-minor' | 'latest-patch';

/**
 * Resolves what to upgrade *to*. Returns null when the registry cannot tell us —
 * the caller must then say "unknown" rather than fabricate a major bump.
 */
export function resolveTargetVersion(
  metadata: PackageMetadata | null,
  currentVersion: string,
  policy: TargetPolicy = 'latest',
): string | null {
  if (!metadata) return null;

  const current = parse(currentVersion);
  const candidates = stableVersions(metadata.versions).filter((v) => compareStrings(v, currentVersion) > 0);
  if (candidates.length === 0) return null;

  if (policy === 'latest') return metadata.latestVersion ?? candidates.at(-1) ?? null;
  if (!current) return candidates.at(-1) ?? null;

  const bounded = candidates.filter((candidate) => {
    const version = parse(candidate);
    if (!version) return false;
    if (version.major !== current.major) return false;
    return policy === 'latest-minor' || version.minor === current.minor;
  });

  return bounded.at(-1) ?? null;
}

/** Probes conventional changelog locations in the repository. */
export async function findChangelogUrl(
  githubSlug: string | undefined,
  refresh = false,
  branch?: string | null,
): Promise<string | undefined> {
  if (!githubSlug) return undefined;

  for (const candidate of branchCandidates(branch)) {
    for (const file of ['CHANGELOG.md', 'CHANGELOG.rst', 'docs/CHANGELOG.md', 'HISTORY.md']) {
      const url = `https://raw.githubusercontent.com/${githubSlug}/${candidate}/${file}`;
      const found = await tryFetchDocument(url, { sourceType: 'official_changelog', refresh, transport: 'direct' });
      if (found) return url;
    }
  }
  return undefined;
}
