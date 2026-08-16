import { NextResponse, type NextRequest } from 'next/server';

import { researchPackageUpgrade } from '@/lib/engine/pipeline';
import type { PackageRef } from '@/lib/engine/request';
import type { Dependency } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/scrape — research without analysis.
 *
 * Kept for callers that want the acquisition step alone. Note that "scrape" is a
 * misnomer for what happens now: sources are planned by authority, served from
 * cache when fresh, and normalized into knowledge objects rather than returned as
 * raw pages.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { dependencies?: Dependency[]; refresh?: boolean; maxDocuments?: number };

    if (!Array.isArray(body.dependencies) || body.dependencies.length === 0) {
      return NextResponse.json({ error: 'Missing dependencies array' }, { status: 400 });
    }

    const scrapedResults: Record<string, unknown> = {};

    for (const dependency of body.dependencies) {
      const ref: PackageRef = {
        name: dependency.name,
        ecosystem: dependency.ecosystem,
        currentVersion: dependency.currentVersion,
        targetVersion: dependency.targetVersion || undefined,
        dependencyType: 'dependencies',
        specifier: dependency.currentVersion,
      };

      const result = await researchPackageUpgrade(ref, {
        refresh: body.refresh,
        maxDocuments: body.maxDocuments,
        targetVersion: dependency.targetVersion || undefined,
      });

      scrapedResults[dependency.name] = {
        change: result.change,
        sources: result.trace.fetched,
        failures: result.trace.failures,
        knowledgeCount: result.knowledge.length,
        servedFromIndex: result.trace.servedFromIndex,
        warnings: result.warnings,
      };
    }

    return NextResponse.json({ success: true, scrapedResults });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Research failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
