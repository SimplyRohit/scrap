import { NextResponse, type NextRequest } from 'next/server';

import { renderBreakingChanges, renderMigrationPlan } from '@/lib/engine/output/markdown';
import { researchPackageUpgrade } from '@/lib/engine/pipeline';
import { validateRequest, RequestValidationError, type KnowledgeRequest, type PackageRef } from '@/lib/engine/request';
import { detectEcosystem } from '@/lib/engine/ingestion/manifest';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/research — gen.md section 26.
 *
 * Researches one package upgrade: registry -> releases -> documentation ->
 * normalization -> index, returning the structured knowledge plus its trace.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as KnowledgeRequest & { includeMarkdown?: boolean };

    const request = validateRequest({ ...body, type: body.type ?? 'package_upgrade' });
    if (request.type !== 'package_upgrade') {
      return NextResponse.json(
        { error: `/api/research handles package_upgrade requests; got "${request.type}"` },
        { status: 400 },
      );
    }

    const ecosystem = request.ecosystem ?? detectEcosystem(request.package!, 'nodejs');
    const ref: PackageRef = {
      name: request.package!,
      ecosystem,
      currentVersion: request.fromVersion ?? request.version!,
      targetVersion: request.toVersion,
      dependencyType: 'dependencies',
      specifier: request.fromVersion ?? request.version!,
    };

    const result = await researchPackageUpgrade(ref, {
      refresh: request.refresh,
      maxDocuments: request.maxDocuments,
      targetVersion: request.toVersion,
    });

    return NextResponse.json({
      success: true,
      package: result.package,
      change: result.change,
      risk: result.risk,
      knowledge: result.knowledge,
      trace: result.trace,
      warnings: result.warnings,
      documents: body.includeMarkdown
        ? {
            'migration.md': renderMigrationPlan(result),
            'breaking-changes.md': renderBreakingChanges(result),
          }
        : undefined,
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Research failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
