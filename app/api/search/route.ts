import { NextResponse, type NextRequest } from 'next/server';

import { categorize, confidenceCaveat } from '@/lib/engine/analysis/confidence';
import { getStore, type SearchQuery } from '@/lib/engine/index/store';

export const runtime = 'nodejs';

/**
 * POST /api/search — hybrid retrieval over the knowledge index (gen.md sections 11, 26).
 *
 * Search never scrapes. It answers from what is indexed, and reports coverage so
 * the caller can decide whether to trigger research via /api/research.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SearchQuery & { query?: string };

    const query: SearchQuery = {
      text: body.text ?? body.query,
      package: body.package,
      ecosystem: body.ecosystem,
      version: body.version,
      types: body.types,
      minConfidence: body.minConfidence,
      errorType: body.errorType,
      limit: body.limit ?? 10,
    };

    if (!query.text && !query.package) {
      return NextResponse.json({ error: 'Provide `query`/`text` or `package`' }, { status: 400 });
    }

    const store = getStore();
    const results = await store.search(query);
    const topConfidence = results[0]?.knowledge.confidence ?? 0;

    return NextResponse.json({
      results: results.map(({ knowledge, score, signals }) => ({
        id: knowledge.id,
        type: knowledge.type,
        package: knowledge.package,
        title: knowledge.title,
        description: knowledge.description,
        severity: knowledge.severity,
        affected: knowledge.affected,
        introduced: knowledge.introduced,
        fixed: knowledge.fixed,
        affectedApis: knowledge.affectedApis,
        migration: knowledge.migration,
        confidence: knowledge.confidence,
        confidenceCategory: categorize(knowledge.confidence),
        sources: knowledge.sources,
        score,
        signals,
      })),
      confidence: topConfidence,
      caveat: confidenceCaveat(topConfidence),
      recommendedAction: results.length === 0 ? ['POST /api/research to index this package first'] : [],
      sources: results.flatMap(({ knowledge }) => knowledge.sources.map((source) => source.url)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
