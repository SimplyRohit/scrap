'use node';

/**
 * Manifest ingestion (gen.md section 24).
 *
 * Parsing is pure and offline; resolving target versions is not — it asks each
 * registry what exists. The two stay separate because "what does this file
 * declare" and "what is available to upgrade to" are different questions, and
 * only the second one needs the network.
 */

import { ConvexError, v } from 'convex/values';

import { action } from './_generated/server';
import { withEngine } from './model/engine';
import { applyLockfileVersions, parseManifest } from '../lib/engine/ingestion/manifest';
import { ecosystemOf, resolveTargets } from '../lib/engine/ingestion/resolve';
import type { Dependency } from '../lib/types';
import { dependency, ecosystem, packageRef } from './validators';

export const parse = action({
  args: {
    content: v.string(),
    fileName: v.optional(v.string()),
    lockfile: v.optional(v.string()),
    /** Skip registry resolution when the caller only wants the parse. */
    resolve: v.optional(v.boolean()),
    refresh: v.optional(v.boolean()),
  },
  returns: v.object({
    ecosystem,
    fileName: v.string(),
    format: v.union(
      v.literal('package.json'),
      v.literal('requirements.txt'),
      v.literal('pyproject.toml'),
      v.literal('unknown'),
    ),
    packages: v.array(packageRef),
    dependencies: v.array(dependency),
    totalCount: v.number(),
    upgradable: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!args.content.trim()) throw new ConvexError('Missing manifest content.');

    const parsed = parseManifest(args.content, args.fileName);
    const warnings = [...parsed.warnings];

    if (args.lockfile) {
      const { packages, matched } = applyLockfileVersions(parsed.packages, args.lockfile);
      parsed.packages = packages;
      warnings.push(`Lockfile pinned ${matched}/${packages.length} package versions.`);
    }

    if (args.resolve === false) {
      return {
        ecosystem: parsed.ecosystem,
        fileName: parsed.fileName,
        format: parsed.format,
        packages: parsed.packages,
        dependencies: [],
        totalCount: parsed.totalCount,
        upgradable: 0,
        warnings,
      };
    }

    // Registry lookups go through the fetch cache, which is why this runs inside
    // `withEngine` even though nothing here touches the knowledge index.
    const resolved = await withEngine(ctx, () => resolveTargets(parsed.packages, { refresh: args.refresh }));

    const dependencies: Dependency[] = resolved.map(({ ref, metadata, targetVersion, reason }) => {
      if (!targetVersion && reason) warnings.push(`${ref.name}: ${reason}`);

      return {
        name: ref.name,
        currentVersion: ref.currentVersion,
        // The UI treats "target equals current" as nothing to do, which is the
        // truth when the registry had nothing newer.
        targetVersion: targetVersion ?? ref.currentVersion,
        ecosystem: ref.ecosystem,
        repoUrl: metadata?.repositoryUrl,
        docsUrl: metadata?.documentationUrl ?? metadata?.homepage ?? metadata?.registryUrl,
        changelogUrl: metadata?.changelogUrl,
      };
    });

    return {
      ecosystem: ecosystemOf(parsed.packages, parsed.ecosystem),
      fileName: parsed.fileName,
      format: parsed.format,
      packages: resolved.map((item) => item.ref),
      dependencies,
      totalCount: parsed.totalCount,
      upgradable: resolved.filter((item) => item.targetVersion).length,
      warnings,
    };
  },
});
