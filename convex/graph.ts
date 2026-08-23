/**
 * The package knowledge graph (gen.md section 10).
 *
 * Derived from the index on every read rather than stored. The graph is a
 * projection of knowledge objects, so re-deriving it is both cheap and the only
 * way to guarantee it is not stale — and as a Convex query it re-derives itself
 * whenever the underlying knowledge changes, which is exactly the behaviour the
 * old route had to fake by never caching.
 */

import { ConvexError, v } from 'convex/values';

import { query } from './_generated/server';
import * as Knowledge from './model/knowledge';
import {
  apisAffectedByVersion,
  buildKnowledgeGraph,
  subgraph,
  versionsFixing,
} from '../lib/engine/index/graph';
import { ecosystem, graphEdge, graphNode } from './validators';

/**
 * Rows the projection will read.
 *
 * A graph over the whole index is a batch job, not a query — this is scoped to
 * a package for the same reason `search` is: a query that reads everything is a
 * query that eventually reads too much.
 */
const MAX_ROWS = 512;

export const forPackage = query({
  args: {
    package: v.string(),
    version: v.optional(v.string()),
    errorFingerprint: v.optional(v.string()),
    ecosystem: v.optional(ecosystem),
  },
  returns: v.object({
    package: v.string(),
    version: v.union(v.null(), v.string()),
    nodes: v.array(graphNode),
    edges: v.array(graphEdge),
    affectedApis: v.optional(v.array(v.string())),
    fixes: v.array(v.object({ error: v.string(), fixedIn: v.array(v.string()) })),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (!args.package.trim()) throw new ConvexError('Provide a `package` — the graph is scoped, not global.');

    const knowledge = await Knowledge.forPackage(ctx, args.package, MAX_ROWS);

    const graph = subgraph(buildKnowledgeGraph(knowledge), {
      package: args.package,
      version: args.version,
      errorFingerprint: args.errorFingerprint,
    });

    return {
      package: args.package,
      version: args.version ?? null,
      nodes: graph.nodes,
      edges: graph.edges,
      // The two traversals worth precomputing: they answer "can I upgrade out
      // of this error" and "what does this version break", which is why section
      // 10 asks for a graph at all.
      affectedApis: args.version ? apisAffectedByVersion(graph, args.package, args.version) : undefined,
      fixes: graph.nodes
        .filter((node) => node.type === 'error')
        .map((node) => ({ error: node.label, fixedIn: versionsFixing(graph, node.id) }))
        .filter((entry) => entry.fixedIn.length > 0),
      truncated: knowledge.length >= MAX_ROWS,
    };
  },
});
