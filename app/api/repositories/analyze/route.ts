import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse, type NextRequest } from 'next/server';

import { applicableKnowledge, correlateRepository, type RepositoryImpact } from '@/lib/engine/analysis/repository';
import { applyLockfileVersions, parseManifest } from '@/lib/engine/ingestion/manifest';
import { renderDocuments, renderRepositoryImpactDocument } from '@/lib/engine/output/markdown';
import { researchManifest } from '@/lib/engine/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MANIFESTS = ['package.json', 'requirements.txt', 'pyproject.toml'];
const LOCKFILES = ['bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

async function readFirst(root: string, candidates: string[]): Promise<{ name: string; content: string } | null> {
  for (const name of candidates) {
    try {
      return { name, content: await readFile(path.join(root, name), 'utf8') };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * POST /api/repositories/analyze — gen.md sections 14, 26.
 *
 * Reads the repository's manifest, researches every upgrade, then correlates the
 * findings against the actual source so the answer is "these three files break",
 * not "this API changed".
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      repository?: string;
      packages?: string[];
      refresh?: boolean;
      maxDocuments?: number;
      includeMarkdown?: boolean;
    };

    const repository = body.repository ?? process.cwd();

    const manifest = await readFirst(repository, MANIFESTS);
    if (!manifest) {
      return NextResponse.json(
        { error: `No manifest found in ${repository} (looked for ${MANIFESTS.join(', ')})` },
        { status: 400 },
      );
    }

    const parsed = parseManifest(manifest.content, manifest.name);

    // The lockfile is authoritative about what is installed; the manifest only
    // states what is permitted.
    const lockfile = await readFirst(repository, LOCKFILES);
    if (lockfile) {
      const { packages } = applyLockfileVersions(parsed.packages, lockfile.content);
      parsed.packages = packages;
    }

    const research = await researchManifest(parsed, {
      refresh: body.refresh,
      maxDocuments: body.maxDocuments,
      packages: body.packages,
    });

    const impacts: Record<string, RepositoryImpact> = {};
    for (const result of research.results) {
      impacts[result.package] = await correlateRepository(repository, result.package, result.knowledge);
    }

    return NextResponse.json({
      repository,
      manifest: manifest.name,
      lockfile: lockfile?.name ?? null,
      overallSafety: research.overallSafety,
      warnings: research.warnings,
      results: research.results.map((result) => {
        const impact = impacts[result.package];
        const applicable = applicableKnowledge(result.knowledge, impact);

        return {
          package: result.package,
          change: result.change,
          risk: result.risk,
          // The distinction that makes this endpoint worth calling: what the
          // package changed, versus what changed that you actually use.
          knowledgeFound: result.knowledge.length,
          knowledgeApplicable: applicable.length,
          usesPackage: impact.usesPackage,
          affectedFiles: impact.affectedFiles,
          affectedSymbols: impact.affectedSymbols,
          sites: {
            imports: impact.importSites,
            symbols: impact.symbolSites,
            config: impact.configSites,
            environment: impact.environmentSites,
            scripts: impact.scriptSites,
          },
          applicableKnowledge: applicable,
          scanned: impact.scanned,
        };
      }),
      documents: body.includeMarkdown
        ? {
            ...renderDocuments(research, impacts),
            // gen.md section 27 names repository-impact.md as its own document,
            // separate from the section embedded in the migration plan.
            'repository-impact.md': research.results
              .map((result) =>
                renderRepositoryImpactDocument(impacts[result.package], result.knowledge),
              )
              .join('\n\n---\n\n'),
          }
        : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Repository analysis failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
