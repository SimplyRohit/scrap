import { describe, expect, test } from 'bun:test';

import {
  apisAffectedByVersion,
  buildKnowledgeGraph,
  findNode,
  neighbors,
  packageNodeId,
  subgraph,
  versionNodeId,
  versionsFixing,
} from '../index/graph';
import { SOURCE_TRUST, type KnowledgeObject, type SourceType } from '../knowledge';
import { renderKnowledgeGraph } from '../output/markdown';

function knowledge(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  const now = new Date().toISOString();
  const id = overrides.id ?? 'k_1';
  return {
    id,
    type: 'removed_api',
    package: 'demo',
    ecosystem: 'nodejs',
    title: '`legacy()` was removed',
    description: '`legacy()` was removed in 6.0.0',
    affectedApis: ['legacy()'],
    affectedConfig: [],
    migration: [],
    severity: 'CRITICAL',
    provenance: 'official',
    sources: [],
    confidence: 0.8,
    fingerprint: `fp_${id}`,
    embedding: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function source(url: string, sourceType: SourceType, title?: string) {
  return {
    url,
    domain: 'example.com',
    sourceType,
    trustScore: SOURCE_TRUST[sourceType],
    retrievedAt: new Date().toISOString(),
    contentHash: 'h',
    title,
  };
}

describe('entity projection', () => {
  test('derives the section 10 entities from one knowledge object', () => {
    const graph = buildKnowledgeGraph([
      knowledge({
        introduced: '6.0.0',
        migration: [{ kind: 'replace', description: 'Use modern()' }],
        sources: [source('https://example.com/guide', 'official_migration_guide', 'Upgrade guide')],
      }),
    ]);

    const types = graph.nodes.map((node) => node.type).sort();
    expect(types).toEqual(['api', 'breaking_change', 'documentation', 'migration', 'package', 'version']);
    expect(findNode(graph, 'change:k_1')?.knowledgeType).toBe('removed_api');
  });

  test('anchors a breaking change to the version that introduced it', () => {
    const graph = buildKnowledgeGraph([knowledge({ introduced: '6.0.0' })]);

    const edge = graph.edges.find((item) => item.relation === 'INTRODUCES');
    expect(edge?.from).toBe(versionNodeId('demo', '6.0.0'));
    expect(findNode(graph, edge!.to)?.label).toBe('`legacy()` was removed');
    // The edge cites the claim it came from, so the graph is auditable.
    expect(edge?.knowledgeId).toBe('k_1');
  });

  test('an error affects a version and is fixed by another', () => {
    // The distinction matters: an error is not introduced by a release the way a
    // breaking change is, and conflating them makes "what fixes this" unanswerable.
    const graph = buildKnowledgeGraph([
      knowledge({
        id: 'k_err',
        type: 'error_solution',
        title: 'PrismaClientInitializationError on boot',
        introduced: '6.0.0',
        fixed: '6.2.1',
        affectedApis: [],
      }),
    ]);

    const relations = graph.edges.map((edge) => edge.relation);
    expect(relations).toContain('AFFECTS');
    expect(relations).toContain('FIXED_BY');
    expect(versionsFixing(graph, 'error:k_err')).toEqual(['6.2.1']);
  });

  test('merges the same version named by several claims into one node', () => {
    const graph = buildKnowledgeGraph([
      knowledge({ id: 'k_1', introduced: '6.0.0' }),
      knowledge({ id: 'k_2', fingerprint: 'fp_2', introduced: '6.0.0', title: 'Config renamed' }),
    ]);

    const versions = graph.nodes.filter((node) => node.type === 'version');
    expect(versions).toHaveLength(1);
    expect(neighbors(graph, versions[0].id).filter((edge) => edge.relation === 'INTRODUCES')).toHaveLength(2);
  });

  test('routes each source type to the relation gen.md gives it', () => {
    const graph = buildKnowledgeGraph([
      knowledge({
        introduced: '6.0.0',
        toVersion: '6.0.0',
        sources: [
          source('https://example.com/release', 'official_release'),
          source('https://example.com/issue/1', 'official_issue'),
          source('https://example.com/commit/abc', 'official_commit'),
          source('https://example.com/docs', 'official_docs'),
        ],
      }),
    ]);

    const byRelation = new Set(graph.edges.map((edge) => edge.relation));
    expect(byRelation).toContain('HAS_RELEASE');
    expect(byRelation).toContain('RELATED_TO');
    expect(byRelation).toContain('RESOLVED_BY');
    expect(byRelation).toContain('DOCUMENTED_BY');
  });

  test('ignores a source type that maps to no entity', () => {
    // A community blog post is evidence, but section 10 has no node for it, and
    // inventing one would put an unranked source on the same footing as a release.
    const graph = buildKnowledgeGraph([
      knowledge({ introduced: '6.0.0', sources: [source('https://blog.example.com/post', 'community')] }),
    ]);

    expect(graph.nodes.some((node) => node.url === 'https://blog.example.com/post')).toBe(false);
  });
});

describe('claim kinds', () => {
  test('a bug fix is a change, not a breaking change', () => {
    // A release of 25 bug fixes must not render as 25 things that break you.
    const graph = buildKnowledgeGraph([
      knowledge({ id: 'k_fix', type: 'bug_fix', title: 'Fix dead link', introduced: '6.0.1', affectedApis: [] }),
    ]);

    expect(findNode(graph, 'change:k_fix')?.type).toBe('change');
    expect(renderKnowledgeGraph(graph, 'demo')).toContain('change: Fix dead link');
  });

  test('a removed API is a breaking change and is labelled as one', () => {
    const graph = buildKnowledgeGraph([knowledge({ introduced: '6.0.0' })]);

    expect(findNode(graph, 'change:k_1')?.type).toBe('breaking_change');
    expect(renderKnowledgeGraph(graph, 'demo')).toContain('breaking: `legacy()` was removed');
  });
});

describe('traversal', () => {
  test('reports the APIs a version breaks, two hops out', () => {
    const graph = buildKnowledgeGraph([
      knowledge({ id: 'k_1', introduced: '6.0.0', affectedApis: ['legacy()'] }),
      knowledge({ id: 'k_2', fingerprint: 'fp_2', introduced: '6.0.0', affectedApis: ['oldConfig'] }),
      knowledge({ id: 'k_3', fingerprint: 'fp_3', introduced: '5.0.0', affectedApis: ['ancient()'] }),
    ]);

    expect(apisAffectedByVersion(graph, 'demo', '6.0.0')).toEqual(['legacy()', 'oldConfig']);
  });

  test('a version with nothing attached reports nothing rather than everything', () => {
    const graph = buildKnowledgeGraph([knowledge({ introduced: '6.0.0' })]);
    expect(apisAffectedByVersion(graph, 'demo', '99.0.0')).toEqual([]);
  });
});

describe('scoping', () => {
  test('one package does not pull in another', () => {
    const graph = buildKnowledgeGraph([
      knowledge({ id: 'k_demo', introduced: '6.0.0' }),
      knowledge({ id: 'k_other', fingerprint: 'fp_o', package: 'other', introduced: '2.0.0', title: 'other change' }),
    ]);

    const scoped = subgraph(graph, { package: 'demo' });
    expect(scoped.nodes.some((node) => node.id === packageNodeId('other'))).toBe(false);
    expect(scoped.nodes.some((node) => node.label === 'other change')).toBe(false);
  });

  test('a shared documentation source does not leak the other package in', () => {
    // Both claims cite one migration guide. Traversing through it would make
    // "what changed in demo" answer with another package's changes.
    const shared = source('https://example.com/shared-guide', 'official_docs');
    const graph = buildKnowledgeGraph([
      knowledge({ id: 'k_demo', introduced: '6.0.0', sources: [shared] }),
      knowledge({
        id: 'k_other',
        fingerprint: 'fp_o',
        package: 'other',
        introduced: '2.0.0',
        title: 'other change',
        sources: [shared],
      }),
    ]);

    const scoped = subgraph(graph, { package: 'demo' });
    expect(scoped.nodes.some((node) => node.label === 'other change')).toBe(false);
    expect(scoped.nodes.some((node) => node.type === 'documentation')).toBe(true);
  });

  test('narrowing to a version drops sibling versions', () => {
    const graph = buildKnowledgeGraph([
      knowledge({ id: 'k_1', introduced: '6.0.0' }),
      knowledge({ id: 'k_2', fingerprint: 'fp_2', introduced: '5.0.0', title: 'older change' }),
    ]);

    const scoped = subgraph(graph, { package: 'demo', version: '6.0.0' });
    expect(scoped.nodes.some((node) => node.version === '5.0.0')).toBe(false);
    expect(scoped.nodes.some((node) => node.label === '`legacy()` was removed')).toBe(true);
  });

  test('keeps the version that fixes an error when scoped to the broken one', () => {
    // Scoping to 6.0.0 must not hide the answer to "what do I upgrade to".
    const graph = buildKnowledgeGraph([
      knowledge({ id: 'k_err', type: 'error_solution', introduced: '6.0.0', fixed: '6.2.1', affectedApis: [] }),
    ]);

    const scoped = subgraph(graph, { package: 'demo', version: '6.0.0' });
    expect(scoped.nodes.some((node) => node.version === '6.2.1')).toBe(true);
  });

  test('an unknown package yields an empty graph, not the whole index', () => {
    const graph = buildKnowledgeGraph([knowledge({ introduced: '6.0.0' })]);
    expect(subgraph(graph, { package: 'absent' }).nodes).toEqual([]);
  });
});

describe('rendering', () => {
  test('draws the tree from section 10', () => {
    const graph = buildKnowledgeGraph([
      knowledge({ id: 'k_1', introduced: '6.0.0' }),
      knowledge({
        id: 'k_err',
        fingerprint: 'fp_e',
        type: 'error_solution',
        title: 'boot failure',
        introduced: '6.0.0',
        fixed: '6.2.0',
        affectedApis: [],
      }),
    ]);

    const tree = renderKnowledgeGraph(graph, 'demo');

    expect(tree.split('\n')[0]).toBe('demo');
    expect(tree).toContain('version 6.0.0');
    expect(tree).toContain('breaking: `legacy()` was removed');
    expect(tree).toContain('fixes: boot failure');
    // The error hangs off the version it affects as well as the one that fixes it.
    expect(tree).toContain('known error: boot failure');
    // Versions are ordered by semver, not by insertion.
    expect(tree.indexOf('6.0.0')).toBeLessThan(tree.indexOf('6.2.0'));
  });

  test('says a version is a boundary rather than drawing an empty branch', () => {
    const graph = buildKnowledgeGraph([knowledge({ fromVersion: '5.0.0', introduced: '6.0.0' })]);
    expect(renderKnowledgeGraph(graph, 'demo')).toContain('referenced only as a version boundary');
  });

  test('shows knowledge that names no version instead of dropping it', () => {
    // A claim with no version anchor has no edge to walk to. It is still a
    // finding, and a graph that quietly omits it reports less than the index holds.
    const graph = buildKnowledgeGraph([
      knowledge({ id: 'k_1', introduced: '6.0.0' }),
      knowledge({ id: 'k_none', fingerprint: 'fp_n', title: 'undated deprecation', introduced: undefined }),
    ]);

    expect(subgraph(graph, { package: 'demo' }).nodes.some((node) => node.label === 'undated deprecation')).toBe(true);

    const tree = renderKnowledgeGraph(graph, 'demo');
    expect(tree).toContain('(no version stated)');
    expect(tree).toContain('undated deprecation');
  });

  test('reports an empty index plainly', () => {
    expect(renderKnowledgeGraph({ nodes: [], edges: [] }, 'demo')).toContain('no versioned knowledge indexed');
  });
});
