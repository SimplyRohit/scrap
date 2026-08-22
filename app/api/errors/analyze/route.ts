import { NextResponse, type NextRequest } from 'next/server';

import { initializeEngine } from '@/lib/engine/bootstrap';
import { resolveError } from '@/lib/engine/errorPipeline';
import type { Ecosystem } from '@/lib/engine/knowledge';
import { renderErrorAnalysis } from '@/lib/engine/output/markdown';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/errors/analyze — gen.md section 26.
 *
 * Answers from the index first and researches only when what we know is
 * insufficient, so a repeated error costs a lookup rather than a scrape.
 */
export async function POST(req: NextRequest) {
  try {
    // Enables semantic retrieval when a provider is configured; harmless otherwise.
    initializeEngine();

    const body = (await req.json()) as {
      package?: string;
      version?: string;
      previousVersion?: string;
      error?: string;
      stackTrace?: string;
      ecosystem?: Ecosystem;
      environment?: Record<string, string>;
      repository?: string;
      indexOnly?: boolean;
      refresh?: boolean;
      maxDocuments?: number;
      includeMarkdown?: boolean;
    };

    if (!body.package) return NextResponse.json({ error: 'Missing `package`' }, { status: 400 });
    if (!body.error) return NextResponse.json({ error: 'Missing `error`' }, { status: 400 });

    const resolution = await resolveError({
      package: body.package,
      version: body.version,
      previousVersion: body.previousVersion,
      error: body.error,
      stackTrace: body.stackTrace,
      ecosystem: body.ecosystem,
      environment: body.environment,
      repository: body.repository,
      indexOnly: body.indexOnly,
      refresh: body.refresh,
      maxDocuments: body.maxDocuments,
    });

    return NextResponse.json({
      diagnosis: resolution.diagnosis,
      likelyCause: resolution.likelyCause,
      fix: resolution.fix,
      affectedVersions: resolution.affectedVersions,
      fixedVersions: resolution.fixedVersions,
      repositoryImpact: resolution.repositoryImpact,
      confidence: resolution.confidence,
      confidenceCategory: resolution.confidenceCategory,
      caveat: resolution.caveat,
      evidence: resolution.evidence,
      fingerprint: resolution.fingerprint,
      trace: resolution.trace,
      documents: body.includeMarkdown ? { 'error-analysis.md': renderErrorAnalysis(resolution) } : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error analysis failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
