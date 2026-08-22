import { NextResponse, type NextRequest } from 'next/server';

import { initializeEngine } from '@/lib/engine/bootstrap';
import { backfillEmbeddings } from '@/lib/engine/index/backfill';
import { embeddingsEnabled } from '@/lib/engine/index/embeddings';
import { getStore } from '@/lib/engine/index/store';
import { detectEcosystem } from '@/lib/engine/ingestion/manifest';
import { researchPackageUpgrade } from '@/lib/engine/pipeline';
import { brightDataConfigured } from '@/lib/engine/research/fetcher';
import { serpConfigured } from '@/lib/engine/research/search';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** GET /api/index — index statistics and engine capability report. */
export async function GET() {
  initializeEngine();
  const stats = await getStore().stats();

  return NextResponse.json({
    ...stats,
    capabilities: {
      brightData: brightDataConfigured(),
      brightDataSerp: serpConfigured(),
      github: Boolean(process.env.GITHUB_TOKEN),
      embeddings: embeddingsEnabled(),
    },
  });
}

/**
 * POST /api/index — index a package on demand (gen.md section 25: `upgrade-intel index <pkg>`),
 * or `{ "action": "backfill" }` to embed indexed knowledge that has no current vector.
 *
 * Without `from`, this indexes the latest release rather than a window: there is
 * no upgrade to bound the research, so we anchor on the current version.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: 'backfill';
      limit?: number;
      package?: string;
      from?: string;
      to?: string;
      ecosystem?: 'nodejs' | 'python' | 'langchain' | 'llamaindex' | 'aiml';
      refresh?: boolean;
      maxDocuments?: number;
    };

    if (body.action === 'backfill') {
      if (!initializeEngine()) {
        return NextResponse.json(
          { error: 'No embedding provider configured — set VOYAGE_API_KEY' },
          { status: 400 },
        );
      }
      const backfill = await backfillEmbeddings({ limit: body.limit, refresh: body.refresh });
      return NextResponse.json({ success: backfill.failures.length === 0, backfill, stats: await getStore().stats() });
    }

    if (!body.package) {
      return NextResponse.json({ error: 'Missing `package`' }, { status: 400 });
    }
    if (!body.from) {
      return NextResponse.json({ error: 'Missing `from` — the version to index changes since' }, { status: 400 });
    }

    const result = await researchPackageUpgrade(
      {
        name: body.package,
        ecosystem: body.ecosystem ?? detectEcosystem(body.package, 'nodejs'),
        currentVersion: body.from,
        targetVersion: body.to,
        dependencyType: 'dependencies',
        specifier: body.from,
      },
      { refresh: body.refresh, maxDocuments: body.maxDocuments, targetVersion: body.to },
    );

    // Newly indexed knowledge is unusable by semantic retrieval until it has a
    // vector, so embed it now rather than waiting for a separate backfill call.
    const backfill = initializeEngine() ? await backfillEmbeddings() : null;

    return NextResponse.json({
      success: true,
      package: result.package,
      indexed: result.knowledge.length,
      embedded: backfill?.embedded ?? 0,
      change: result.change,
      trace: result.trace,
      warnings: result.warnings,
      stats: await getStore().stats(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Indexing failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
