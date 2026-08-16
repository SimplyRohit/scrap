import { NextResponse, type NextRequest } from 'next/server';

import { parseManifest, applyLockfileVersions } from '@/lib/engine/ingestion/manifest';
import { ecosystemOf, resolveTargets } from '@/lib/engine/ingestion/resolve';
import type { Dependency } from '@/lib/types';

// fs-backed cache and index require the Node runtime.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      content?: string;
      fileName?: string;
      lockfile?: string;
      /** Skip registry resolution when the caller only wants the parse. */
      resolve?: boolean;
      refresh?: boolean;
    };

    if (!body.content || typeof body.content !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid manifest content' }, { status: 400 });
    }

    const parsed = parseManifest(body.content, body.fileName);
    const warnings = [...parsed.warnings];

    if (body.lockfile) {
      const { packages, matched } = applyLockfileVersions(parsed.packages, body.lockfile);
      parsed.packages = packages;
      warnings.push(`Lockfile pinned ${matched}/${packages.length} package versions.`);
    }

    if (body.resolve === false) {
      return NextResponse.json({ ...parsed, warnings, dependencies: [] });
    }

    const resolved = await resolveTargets(parsed.packages, { refresh: body.refresh });

    // Legacy view model: the UI reads `dependencies`.
    const dependencies: Dependency[] = resolved.map(({ ref, metadata, targetVersion, reason }) => {
      if (!targetVersion && reason) warnings.push(`${ref.name}: ${reason}`);
      return {
        name: ref.name,
        currentVersion: ref.currentVersion,
        targetVersion: targetVersion ?? ref.currentVersion,
        ecosystem: ref.ecosystem,
        repoUrl: metadata?.repositoryUrl,
        docsUrl: metadata?.documentationUrl ?? metadata?.homepage ?? metadata?.registryUrl,
        changelogUrl: metadata?.changelogUrl,
      };
    });

    return NextResponse.json({
      ecosystem: ecosystemOf(parsed.packages, parsed.ecosystem),
      fileName: parsed.fileName,
      format: parsed.format,
      packages: resolved.map((item) => item.ref),
      dependencies,
      totalCount: parsed.totalCount,
      upgradable: resolved.filter((item) => item.targetVersion).length,
      warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse manifest';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
