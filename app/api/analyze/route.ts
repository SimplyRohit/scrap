import { NextResponse, type NextRequest } from 'next/server';

import { toBlastRadiusAnalysis } from '@/lib/engine/adapters/legacy';
import { parseManifest, type ManifestParseResult } from '@/lib/engine/ingestion/manifest';
import { renderDocuments } from '@/lib/engine/output/markdown';
import { researchManifest } from '@/lib/engine/pipeline';
import type { PackageRef } from '@/lib/engine/request';
import type { Dependency } from '@/lib/types';

export const runtime = 'nodejs';
// Research fans out across registries, GitHub, and documentation hosts.
export const maxDuration = 300;

function toPackageRef(dependency: Dependency): PackageRef {
  return {
    name: dependency.name,
    ecosystem: dependency.ecosystem,
    currentVersion: dependency.currentVersion,
    targetVersion: dependency.targetVersion || undefined,
    dependencyType: 'dependencies',
    specifier: dependency.currentVersion,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      dependencies?: Dependency[];
      manifest?: { content: string; fileName?: string };
      refresh?: boolean;
      maxDocuments?: number;
      includeMarkdown?: boolean;
    };

    let parsed: ManifestParseResult;

    if (body.manifest?.content) {
      parsed = parseManifest(body.manifest.content, body.manifest.fileName);
    } else if (Array.isArray(body.dependencies) && body.dependencies.length > 0) {
      const packages = body.dependencies.map(toPackageRef);
      parsed = {
        ecosystem: packages[0].ecosystem,
        fileName: 'dependencies',
        format: 'unknown',
        packages,
        totalCount: packages.length,
        warnings: [],
      };
    } else {
      return NextResponse.json({ error: 'Provide `dependencies` or `manifest.content`' }, { status: 400 });
    }

    const research = await researchManifest(parsed, {
      refresh: body.refresh,
      maxDocuments: body.maxDocuments,
    });

    return NextResponse.json({
      success: true,
      // Legacy view model consumed by the existing UI.
      analysis: toBlastRadiusAnalysis(research),
      // Structured knowledge is the canonical representation; Markdown is opt-in.
      engine: {
        id: research.id,
        overallSafety: research.overallSafety,
        totalKnowledge: research.totalKnowledge,
        warnings: research.warnings,
        results: research.results.map((result) => ({
          package: result.package,
          change: result.change,
          risk: result.risk,
          knowledge: result.knowledge,
          trace: result.trace,
        })),
      },
      documents: body.includeMarkdown ? renderDocuments(research) : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
