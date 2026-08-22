import { NextResponse, type NextRequest } from 'next/server';

import {
  applicableKnowledge,
  correlateRepository,
  type RepositoryImpact,
} from '@/lib/engine/analysis/repository';
import { initializeEngine } from '@/lib/engine/bootstrap';
import { resolveError, type ErrorResolution } from '@/lib/engine/errorPipeline';
import { detectEcosystem } from '@/lib/engine/ingestion/manifest';
import type { Ecosystem, KnowledgeObject } from '@/lib/engine/knowledge';
import { renderMigrationPlan } from '@/lib/engine/output/markdown';
import { researchPackageUpgrade, type PackageResearchResult } from '@/lib/engine/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface PackageChangeInput {
  package: string;
  from: string;
  to?: string;
  ecosystem?: Ecosystem;
}

interface ErrorInput {
  package: string;
  version?: string;
  previousVersion?: string;
  error: string;
  stackTrace?: string;
  ecosystem?: Ecosystem;
}

/**
 * POST /api/agent/resolve — the agent protocol (gen.md sections 16, 26).
 *
 * One call covers both halves of the loop: what a set of package changes will
 * break, and what a set of observed errors means. The response is shaped for a
 * coding agent to act on directly, and deliberately separates what is
 * evidence-backed from what is merely suggested — an agent must not apply an
 * unverified migration.
 */
export async function POST(req: NextRequest) {
  try {
    // Enables semantic retrieval when a provider is configured; harmless otherwise.
    initializeEngine();

    const body = (await req.json()) as {
      repository?: string;
      packageChanges?: PackageChangeInput[];
      errors?: ErrorInput[];
      refresh?: boolean;
      maxDocuments?: number;
      includeMarkdown?: boolean;
    };

    const packageChanges = body.packageChanges ?? [];
    const errors = body.errors ?? [];

    if (packageChanges.length === 0 && errors.length === 0) {
      return NextResponse.json({ error: 'Provide `packageChanges` and/or `errors`' }, { status: 400 });
    }

    const upgrades: PackageResearchResult[] = [];
    for (const change of packageChanges) {
      upgrades.push(
        await researchPackageUpgrade(
          {
            name: change.package,
            ecosystem: change.ecosystem ?? detectEcosystem(change.package, 'nodejs'),
            currentVersion: change.from,
            targetVersion: change.to,
            dependencyType: 'dependencies',
            specifier: change.from,
          },
          { refresh: body.refresh, maxDocuments: body.maxDocuments, targetVersion: change.to },
        ),
      );
    }

    const resolutions: ErrorResolution[] = [];
    for (const item of errors) {
      resolutions.push(
        await resolveError({
          package: item.package,
          version: item.version,
          previousVersion: item.previousVersion,
          error: item.error,
          stackTrace: item.stackTrace,
          ecosystem: item.ecosystem,
          repository: body.repository,
          refresh: body.refresh,
          maxDocuments: body.maxDocuments,
        }),
      );
    }

    const relevantKnowledge: KnowledgeObject[] = upgrades.flatMap((result) => result.knowledge);

    // With a repository, impact is resolved to real files. Without one, the agent
    // gets symbols to search for and is told so explicitly.
    const impacts: Record<string, RepositoryImpact> = {};
    if (body.repository) {
      for (const result of upgrades) {
        impacts[result.package] = await correlateRepository(body.repository, result.package, result.knowledge);
      }
      for (const resolution of resolutions) {
        const name = resolution.fingerprint.package;
        impacts[name] ??= await correlateRepository(
          body.repository,
          name,
          relevantKnowledge.filter((item) => item.package === name),
        );
      }
    }

    return NextResponse.json({
      repository: body.repository ?? null,
      packageChanges: upgrades.map((result) => {
        const impact = impacts[result.package];
        return {
          package: result.package,
          change: result.change,
          risk: result.risk,
          breakingChanges: result.knowledge.length,
          applicableChanges: impact ? applicableKnowledge(result.knowledge, impact).length : null,
          affectedFiles: impact?.affectedFiles ?? null,
          usesPackage: impact?.usesPackage ?? null,
        };
      }),
      errors: resolutions.map((resolution) => ({
        fingerprint: resolution.fingerprint.fingerprint,
        errorType: resolution.fingerprint.errorType,
        diagnosis: resolution.diagnosis,
        likelyCause: resolution.likelyCause,
        fix: resolution.fix,
        affectedVersions: resolution.affectedVersions,
        fixedVersions: resolution.fixedVersions,
        confidence: resolution.confidence,
        caveat: resolution.caveat,
        repositoryImpact: impacts[resolution.fingerprint.package]?.affectedFiles ?? resolution.repositoryImpact,
      })),
      relevantKnowledge,
      migrationPlan: upgrades.map((result) => ({
        package: result.package,
        risk: result.risk.level,
        steps: result.knowledge.flatMap((item) => item.migration),
        markdown: body.includeMarkdown ? renderMigrationPlan(result, impacts[result.package]) : undefined,
      })),
      evidence: [
        ...relevantKnowledge.flatMap((item) =>
          item.sources.map((source) => ({
            knowledgeId: item.id,
            url: source.url,
            sourceType: source.sourceType,
            quotedText: source.quotedText,
            confidence: item.confidence,
          })),
        ),
        ...resolutions.flatMap((resolution) => resolution.evidence),
      ],
      // gen.md section 16: an agent must never modify the repository blindly.
      instructions: [
        'Inspect the repository before changing anything.',
        'Only apply steps whose evidence is version-matched and officially sourced.',
        'Treat any finding carrying a `caveat` as a hypothesis to verify, not a fix to apply.',
        'Run tests, typecheck, and build after applying changes.',
        'Re-submit any remaining error to /api/errors/analyze rather than guessing.',
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent resolution failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
