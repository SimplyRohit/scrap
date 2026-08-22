import { NextResponse, type NextRequest } from 'next/server';

import { getStore } from '@/lib/engine/index/store';
import {
  apisAffectedByVersion,
  buildKnowledgeGraph,
  subgraph,
  versionsFixing,
} from '@/lib/engine/index/graph';
import { renderKnowledgeGraph } from '@/lib/engine/output/markdown';

export const runtime = 'nodejs';

/**
 * GET /api/graph — the package knowledge graph (gen.md section 10).
 *
 * Derived from the index on each request rather than stored. The graph is a
 * projection of knowledge objects, so re-deriving it is both cheap and the only
 * way to guarantee it is not stale.
 *
 * `?package=next` scopes to one package, `&version=16.0.0` to the subgraph
 * around one version, and `&format=tree` returns the section 10 diagram.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const packageName = params.get('package') ?? undefined;
  const version = params.get('version') ?? undefined;

  const knowledge = await getStore().all();
  const scoped = packageName ? knowledge.filter((item) => item.package === packageName) : knowledge;
  const graph = subgraph(buildKnowledgeGraph(scoped), { package: packageName, version });

  if (params.get('format') === 'tree') {
    return new NextResponse(renderKnowledgeGraph(graph, packageName ?? 'index'), {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return NextResponse.json({
    package: packageName ?? null,
    version: version ?? null,
    nodes: graph.nodes,
    edges: graph.edges,
    // The two traversals worth precomputing: they answer "can I upgrade out of
    // this error" and "what does this version break", which is why section 10
    // asks for a graph at all.
    ...(packageName && version ? { affectedApis: apisAffectedByVersion(graph, packageName, version) } : {}),
    fixes: graph.nodes
      .filter((node) => node.type === 'error')
      .map((node) => ({ error: node.label, fixedIn: versionsFixing(graph, node.id) }))
      .filter((entry) => entry.fixedIn.length > 0),
  });
}
