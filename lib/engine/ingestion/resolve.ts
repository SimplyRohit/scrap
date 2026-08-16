/**
 * Target-version resolution.
 *
 * Split out from the manifest parser so that parsing stays pure and offline:
 * "what does this file declare" is a different question from "what is available
 * to upgrade to", and only the second one needs the network.
 */

import type { Ecosystem } from '../knowledge';
import type { PackageRef } from '../request';
import { resolveTargetVersion, tryFetchPackageMetadata, type PackageMetadata, type TargetPolicy } from '../research/registry';

export interface ResolvedPackage {
  ref: PackageRef;
  metadata: PackageMetadata | null;
  /** Null when the registry has nothing newer, or could not be reached. */
  targetVersion: string | null;
  reason?: string;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const position = cursor++;
      results[position] = await worker(items[position]);
    }
  });

  await Promise.all(runners);
  return results;
}

export async function resolveTargets(
  packages: PackageRef[],
  options: { policy?: TargetPolicy; refresh?: boolean; concurrency?: number } = {},
): Promise<ResolvedPackage[]> {
  const { policy = 'latest', refresh = false, concurrency = 6 } = options;

  return mapWithConcurrency(packages, concurrency, async (ref) => {
    const metadata = await tryFetchPackageMetadata(ref.name, ref.ecosystem, refresh);

    if (!metadata) {
      return { ref, metadata: null, targetVersion: null, reason: 'registry lookup failed' };
    }

    const targetVersion = resolveTargetVersion(metadata, ref.currentVersion, policy);
    return {
      ref: { ...ref, targetVersion: targetVersion ?? undefined },
      metadata,
      targetVersion,
      reason: targetVersion ? undefined : 'already at or above the latest published version',
    };
  });
}

export function ecosystemOf(packages: PackageRef[], fallback: Ecosystem): Ecosystem {
  const counts = new Map<Ecosystem, number>();
  for (const pkg of packages) counts.set(pkg.ecosystem, (counts.get(pkg.ecosystem) ?? 0) + 1);

  // The manifest's ecosystem is whichever specialised ecosystem dominates;
  // generic ones only win when nothing more specific is present.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const specialised = ranked.find(([ecosystem]) => ecosystem !== 'nodejs' && ecosystem !== 'python');
  return specialised?.[0] ?? ranked[0]?.[0] ?? fallback;
}
