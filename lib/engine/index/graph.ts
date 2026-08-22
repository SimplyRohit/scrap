/**
 * Package knowledge graph (gen.md section 10).
 *
 * The graph is a *projection*, not a store. Every node and edge is derived from
 * the `KnowledgeObject`s already in the index, so there is nothing to keep in
 * sync and no second source of truth to drift: re-derive it and it is current.
 * gen.md is explicit that a graph database is not warranted yet, and it is not —
 * the relationships it names are already implied by fields we hold.
 *
 * What this adds is the ability to *ask* graph questions: which versions fix
 * this error, which APIs a version's breaking changes touch, which issue a claim
 * came from.
 */

import { isBreaking } from '../analysis/versionDiff';
import type { KnowledgeObject } from '../knowledge';

/**
 * gen.md section 10 entity list, plus one addition.
 *
 * `change` is not in the spec's list. It is here because most of what a release
 * contains — bug fixes, performance work, docs — is neither a breaking change
 * nor an error, and filing it under `breaking_change` would make a tree of 25
 * bug fixes read as 25 things that will break your build. Dropping it instead
 * would make the graph report less than the index holds. So it gets its own
 * node, and `knowledgeType` carries what it actually is.
 */
export type NodeType =
  | 'package'
  | 'version'
  | 'release'
  | 'breaking_change'
  | 'change'
  | 'api'
  | 'error'
  | 'issue'
  | 'commit'
  | 'migration'
  | 'documentation';

/** gen.md section 10 relation list, verbatim. */
export type RelationType =
  | 'HAS_VERSION'
  | 'HAS_RELEASE'
  | 'INTRODUCES'
  | 'AFFECTS'
  | 'FIXED_BY'
  | 'RELATED_TO'
  | 'RESOLVED_BY'
  | 'DOCUMENTED_BY'
  | 'REQUIRES';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  /** Knowledge objects that evidence this node. Empty means it was inferred
   * structurally — a version mentioned as a boundary, for instance. */
  knowledge: string[];
  /** Present on version and release nodes. */
  version?: string;
  /**
   * Present on nodes that belong to exactly one package. Source nodes are keyed
   * by URL and can be cited by several packages, so they carry no owner.
   */
  package?: string;
  url?: string;
  severity?: KnowledgeObject['severity'];
  confidence?: number;
  /** The knowledge type behind a claim node, e.g. `removed_api`, `bug_fix`. */
  knowledgeType?: KnowledgeObject['type'];
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: RelationType;
  /** The knowledge object that justifies this edge, when one does. */
  knowledgeId?: string;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphQuery {
  package?: string;
  /** Restricts to the subgraph reachable from this version. */
  version?: string;
  /** Restricts to the subgraph around one error fingerprint. */
  errorFingerprint?: string;
}

class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();

  node(node: GraphNode): string {
    const existing = this.nodes.get(node.id);
    if (!existing) {
      this.nodes.set(node.id, { ...node, knowledge: [...node.knowledge] });
      return node.id;
    }

    // A node named by several claims accumulates their ids rather than being
    // overwritten by whichever was seen last.
    for (const id of node.knowledge) {
      if (!existing.knowledge.includes(id)) existing.knowledge.push(id);
    }
    if (existing.url === undefined && node.url) existing.url = node.url;
    return node.id;
  }

  edge(from: string, relation: RelationType, to: string, knowledgeId?: string): void {
    const key = `${from}|${relation}|${to}`;
    if (!this.edges.has(key)) this.edges.set(key, { from, to, relation, knowledgeId });
  }

  build(): KnowledgeGraph {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }
}

export function packageNodeId(name: string): string {
  return `package:${name}`;
}

export function versionNodeId(name: string, version: string): string {
  return `version:${name}@${version}`;
}

/** Node types that carry a claim, in the order a reader wants to see them. */
const SOURCE_NODE_TYPE: Partial<Record<KnowledgeObject['sources'][number]['sourceType'], NodeType>> = {
  official_release: 'release',
  official_commit: 'commit',
  official_issue: 'issue',
  official_docs: 'documentation',
  official_migration_guide: 'documentation',
  official_changelog: 'documentation',
  technical_docs: 'documentation',
};

export function buildKnowledgeGraph(knowledge: KnowledgeObject[]): KnowledgeGraph {
  const builder = new GraphBuilder();

  for (const item of knowledge) {
    const pkg = builder.node({
      id: packageNodeId(item.package),
      type: 'package',
      label: item.package,
      knowledge: [],
    });

    const versionNode = (version: string): string => {
      const id = builder.node({
        id: versionNodeId(item.package, version),
        type: 'version',
        label: `${item.package}@${version}`,
        knowledge: [],
        package: item.package,
        version,
      });
      builder.edge(pkg, 'HAS_VERSION', id);
      return id;
    };

    // Every version this claim names becomes a node, whether or not the claim
    // is anchored to it — the window boundaries are part of the answer.
    for (const version of [item.fromVersion, item.toVersion, item.introduced, item.fixed]) {
      if (version) versionNode(version);
    }

    const introducedIn = item.introduced ? versionNodeId(item.package, item.introduced) : null;

    // An error signature is a different kind of entity from a breaking change,
    // and gen.md gives them different relations: an error AFFECTS a version and
    // is FIXED_BY another, where a breaking change is INTRODUCED by one.
    const isError = item.type === 'error_solution' || Boolean(item.errorFingerprint);

    const nodeType: NodeType = isError ? 'error' : isBreaking(item) ? 'breaking_change' : 'change';

    const claim = builder.node({
      id: `${nodeType === 'error' ? 'error' : 'change'}:${item.id}`,
      type: nodeType,
      label: item.title,
      knowledge: [item.id],
      package: item.package,
      severity: item.severity,
      confidence: item.confidence,
      knowledgeType: item.type,
    });

    if (isError) {
      if (introducedIn) builder.edge(claim, 'AFFECTS', introducedIn, item.id);
      if (item.fixed) builder.edge(claim, 'FIXED_BY', versionNodeId(item.package, item.fixed), item.id);
    } else if (introducedIn) {
      // Both breaking and non-breaking claims are introduced by their version;
      // the node type, not the edge, is what says which kind it is.
      builder.edge(introducedIn, 'INTRODUCES', claim, item.id);
    }

    for (const api of item.affectedApis) {
      const apiNode = builder.node({
        id: `api:${item.package}:${api}`,
        type: 'api',
        label: api,
        knowledge: [item.id],
        package: item.package,
      });
      builder.edge(claim, 'AFFECTS', apiNode, item.id);
    }

    if (item.migration.length > 0) {
      const migration = builder.node({
        id: `migration:${item.id}`,
        type: 'migration',
        label: item.migration[0].description || `Migration for ${item.title}`,
        knowledge: [item.id],
        package: item.package,
      });
      builder.edge(claim, 'REQUIRES', migration, item.id);
    }

    for (const source of item.sources) {
      const type = SOURCE_NODE_TYPE[source.sourceType];
      if (!type) continue;

      const sourceNode = builder.node({
        id: `${type}:${source.url}`,
        type,
        label: source.title ?? source.url,
        knowledge: [item.id],
        url: source.url,
        ...(type === 'release' && item.toVersion ? { version: item.toVersion } : {}),
      });

      if (type === 'release') {
        const anchor = item.toVersion ?? item.introduced;
        if (anchor) builder.edge(versionNodeId(item.package, anchor), 'HAS_RELEASE', sourceNode, item.id);
      } else if (type === 'issue') {
        // gen.md pairs ISSUE with ERROR; a breaking change cited to an issue is
        // still related to it, which is the same edge in the other direction.
        builder.edge(claim, 'RELATED_TO', sourceNode, item.id);
      } else if (type === 'commit') {
        builder.edge(sourceNode, 'RESOLVED_BY', claim, item.id);
      } else {
        builder.edge(claim, 'DOCUMENTED_BY', sourceNode, item.id);
      }
    }
  }

  return builder.build();
}

/** Edges touching a node, in either direction. */
export function neighbors(graph: KnowledgeGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
}

export function findNode(graph: KnowledgeGraph, nodeId: string): GraphNode | null {
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
}

/**
 * Versions that fix an error, resolved by walking `ERROR ─FIXED_BY→ VERSION`.
 *
 * This is the question the error loop actually asks, and answering it from the
 * graph rather than by re-scanning knowledge objects is the point of having one.
 */
export function versionsFixing(graph: KnowledgeGraph, errorNodeId: string): string[] {
  return graph.edges
    .filter((edge) => edge.relation === 'FIXED_BY' && edge.from === errorNodeId)
    .map((edge) => findNode(graph, edge.to)?.version)
    .filter((version): version is string => Boolean(version));
}

/** APIs touched by the breaking changes a version introduces — a two-hop walk. */
export function apisAffectedByVersion(graph: KnowledgeGraph, packageName: string, version: string): string[] {
  const versionId = versionNodeId(packageName, version);
  const changes = graph.edges
    .filter((edge) => edge.relation === 'INTRODUCES' && edge.from === versionId)
    .map((edge) => edge.to);

  const apis = new Set<string>();
  for (const change of changes) {
    for (const edge of graph.edges) {
      if (edge.relation !== 'AFFECTS' || edge.from !== change) continue;
      const node = findNode(graph, edge.to);
      if (node?.type === 'api') apis.add(node.label);
    }
  }
  return [...apis].sort();
}

/**
 * The subgraph around one package, optionally narrowed to a version.
 *
 * Membership is computed by walking out from the package node rather than by
 * matching id prefixes: claim nodes are keyed by knowledge id and carry no
 * package in their id, so a prefix test would either miss them or, worse, keep
 * another package's. Source nodes are keyed by URL and can legitimately be
 * shared between packages, so the walk treats them as terminal — otherwise one
 * shared migration guide would drag an unrelated package into the answer.
 */
export function subgraph(graph: KnowledgeGraph, query: GraphQuery): KnowledgeGraph {
  if (!query.package) return graph;

  const root = packageNodeId(query.package);
  if (!graph.nodes.some((node) => node.id === root)) return { nodes: [], edges: [] };

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    for (const end of [edge.from, edge.to]) {
      const bucket = adjacency.get(end) ?? [];
      bucket.push(edge);
      adjacency.set(end, bucket);
    }
  }

  // Owned nodes are seeded rather than discovered. A claim that names no version
  // has no edge to walk, and dropping it would silently shrink the answer — the
  // graph would report less than the index holds and look complete doing it.
  const keep = new Set<string>([root]);
  for (const node of graph.nodes) {
    if (node.package === query.package) keep.add(node.id);
  }
  const queue = [...keep];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current !== root && !expandable(byId.get(current))) continue;

    for (const edge of adjacency.get(current) ?? []) {
      const next = edge.from === current ? edge.to : edge.from;
      if (keep.has(next)) continue;
      // Never cross into a second package.
      if (byId.get(next)?.type === 'package') continue;
      keep.add(next);
      queue.push(next);
    }
  }

  if (query.version) {
    const versionId = versionNodeId(query.package, query.version);
    if (!keep.has(versionId)) return { nodes: [byId.get(root)!], edges: [] };

    // Two hops from the named version: the claims anchored to it, then what
    // those claims point at. Sibling versions are dropped, or "what changed in
    // 6.0" returns the package's whole history.
    const scoped = new Set<string>([root, versionId]);
    for (const edge of adjacency.get(versionId) ?? []) {
      scoped.add(edge.from === versionId ? edge.to : edge.from);
    }
    for (const id of [...scoped]) {
      if (isVersionNode(id) || id === root) continue;
      for (const edge of adjacency.get(id) ?? []) {
        const next = edge.from === id ? edge.to : edge.from;
        // A `FIXED_BY` target is another version and is exactly what the caller
        // wants to see, so versions reached from a claim stay.
        scoped.add(next);
      }
    }

    for (const id of [...scoped]) {
      if (!keep.has(id)) scoped.delete(id);
    }
    return materialize(graph, byId, scoped);
  }

  return materialize(graph, byId, keep);
}

/** Source nodes are shared across packages, so the walk stops at them. */
function expandable(node: GraphNode | undefined): boolean {
  if (!node) return false;
  return node.type !== 'release' && node.type !== 'issue' && node.type !== 'commit' && node.type !== 'documentation';
}

function materialize(graph: KnowledgeGraph, byId: Map<string, GraphNode>, ids: Set<string>): KnowledgeGraph {
  return {
    nodes: [...ids].map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node)),
    edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  };
}

function isVersionNode(id: string): boolean {
  return id.startsWith('version:');
}
