/**
 * Source prioritisation (gen.md section 5).
 *
 * "Do NOT blindly scrape random search results." Sources are planned from
 * registry metadata in priority order, fetched until the budget is spent, and
 * each one carries a `sourceType` that drives both trust and cache TTL.
 */

import { SOURCE_TRUST, sourcePriority, type SourceType } from '../knowledge';
import type { PackageMetadata } from './registry';

export interface SourceCandidate {
  url: string;
  sourceType: SourceType;
  title: string;
  /** Why this URL was chosen — surfaced in the research trace. */
  reason: string;
  /** Lower is more authoritative. */
  priority: number;
  trustScore: number;
  /** Speculative URLs (conventional doc paths) are allowed to 404 silently. */
  speculative: boolean;
}

const OFFICIAL_DOC_HOSTS = [
  /\.?docs?\./i,
  /readthedocs\.io$/i,
  /\.dev$/i,
  /\.io$/i,
];

const COMMUNITY_HOSTS = /stackoverflow\.com|reddit\.com|dev\.to|medium\.com|hashnode|discourse|forum\./i;

/** Classifies an arbitrary URL into the priority ladder. */
export function classifySource(url: string): SourceType {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'web';
  }

  const { hostname, pathname } = parsed;
  const path = pathname.toLowerCase();

  if (hostname === 'github.com' || hostname === 'api.github.com' || hostname === 'raw.githubusercontent.com') {
    if (/\/releases/.test(path)) return 'official_release';
    if (/\/commit/.test(path)) return 'official_commit';
    if (/\/(issues|pull)/.test(path)) return 'official_issue';
    if (/changelog|history|changes/.test(path)) return 'official_changelog';
    if (/migrat|upgrad/.test(path)) return 'official_migration_guide';
    return 'official_docs';
  }

  if (hostname === 'registry.npmjs.org' || hostname === 'www.npmjs.com' || hostname === 'pypi.org') {
    return 'package_registry';
  }

  if (COMMUNITY_HOSTS.test(hostname)) return 'community';

  if (/migrat|upgrad|breaking/.test(path)) return 'official_migration_guide';
  if (/changelog|release-notes|changes|whats-new/.test(path)) return 'official_changelog';
  if (OFFICIAL_DOC_HOSTS.some((pattern) => pattern.test(hostname)) || /\/docs?\//.test(path)) {
    return 'official_docs';
  }

  return 'web';
}

function candidate(
  url: string,
  sourceType: SourceType,
  title: string,
  reason: string,
  speculative = false,
): SourceCandidate {
  return {
    url,
    sourceType,
    title,
    reason,
    priority: sourcePriority(sourceType),
    trustScore: SOURCE_TRUST[sourceType],
    speculative,
  };
}

/** Conventional migration-guide paths, probed against the package's own docs host. */
const MIGRATION_PATHS = [
  'migration',
  'migrating',
  'upgrade',
  'upgrading',
  'docs/migration',
  'docs/upgrade',
  'guides/upgrading',
  'blog/upgrade',
];

function docsOrigin(metadata: PackageMetadata): string | null {
  const source = metadata.documentationUrl ?? metadata.homepage;
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.hostname.includes('github.com')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function docsDomain(metadata: PackageMetadata): string | undefined {
  const origin = docsOrigin(metadata);
  if (!origin) return undefined;
  try {
    return new URL(origin).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Plans the fetch order for an upgrade. Deterministic sources first; web search
 * is a separate, later step so a run never depends on it.
 */
export function planUpgradeSources(
  metadata: PackageMetadata,
  toVersion: string,
  options: { includeSpeculative?: boolean } = {},
): SourceCandidate[] {
  const { includeSpeculative = true } = options;
  const candidates: SourceCandidate[] = [];

  const origin = docsOrigin(metadata);
  if (origin && includeSpeculative) {
    for (const path of MIGRATION_PATHS) {
      candidates.push(
        candidate(
          `${origin}/${path}`,
          'official_migration_guide',
          `${metadata.name} migration guide`,
          `conventional migration path on the package's documentation host`,
          true,
        ),
      );
    }
  }

  if (metadata.changelogUrl) {
    candidates.push(
      candidate(metadata.changelogUrl, 'official_changelog', `${metadata.name} changelog`, 'changelog URL declared by the registry'),
    );
  }

  if (metadata.githubSlug) {
    candidates.push(
      candidate(
        `https://github.com/${metadata.githubSlug}/releases/tag/v${toVersion}`,
        'official_release',
        `${metadata.name} v${toVersion} release notes`,
        'release notes for the target version',
      ),
    );

    for (const file of ['CHANGELOG.md', 'HISTORY.md', 'docs/migration.md', 'UPGRADING.md']) {
      candidates.push(
        candidate(
          `https://raw.githubusercontent.com/${metadata.githubSlug}/main/${file}`,
          file.toLowerCase().includes('migrat') || file.toLowerCase().includes('upgrad')
            ? 'official_migration_guide'
            : 'official_changelog',
          `${metadata.name} ${file}`,
          'conventional in-repository changelog',
          true,
        ),
      );
    }
  }

  if (metadata.documentationUrl) {
    candidates.push(
      candidate(metadata.documentationUrl, 'official_docs', `${metadata.name} documentation`, 'documentation URL declared by the registry'),
    );
  }

  candidates.push(
    candidate(metadata.registryUrl, 'package_registry', `${metadata.name} on the registry`, 'registry listing'),
  );

  // Declared URLs before guessed ones, then by authority. A changelog the registry
  // actually points at is better evidence than a migration guide we invented from
  // a naming convention — and ordering guesses first can exhaust the attempt
  // budget before any real source is reached.
  const ordered = dedupeByUrl(candidates).sort((a, b) => {
    if (a.speculative !== b.speculative) return a.speculative ? 1 : -1;
    return a.priority - b.priority;
  });

  return capSpeculativePerHost(ordered);
}

/**
 * Limits how many guesses any single host contributes.
 *
 * Eight conventional migration paths on one documentation host would otherwise
 * consume the entire attempt budget, leaving a package's in-repo CHANGELOG.md
 * unreachable — which for packages that never cut GitHub releases means no
 * sources at all.
 */
const MAX_SPECULATIVE_PER_HOST = 3;

function capSpeculativePerHost(candidates: SourceCandidate[]): SourceCandidate[] {
  const perHost = new Map<string, number>();

  return candidates.filter((candidate) => {
    if (!candidate.speculative) return true;

    const host = domainOf(candidate.url);
    const used = perHost.get(host) ?? 0;
    if (used >= MAX_SPECULATIVE_PER_HOST) return false;

    perHost.set(host, used + 1);
    return true;
  });
}

export function dedupeByUrl(candidates: SourceCandidate[]): SourceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = item.url.replace(/\/+$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}
