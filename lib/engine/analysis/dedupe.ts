/**
 * Deduplication and evidence merging (gen.md section 12).
 *
 * The same change appears in the changelog, the release notes, the docs, and a
 * blog post. Storing four copies would quadruple-count as "multiple independent
 * sources" and inflate confidence. Instead one knowledge object accumulates the
 * sources as evidence, and confidence is rescored over the merged set.
 */

import { tokenSimilarity } from '../hash';
import { isInWindow } from '../semver';
import type { KnowledgeObject, Provenance, SourceRef } from '../knowledge';
import { SEVERITY_ORDER, sourcePriority } from '../knowledge';
import { scoreConfidence } from './confidence';

/** Above this Jaccard similarity, two differently-fingerprinted claims are the same change. */
const SEMANTIC_DUPLICATE_THRESHOLD = 0.62;

/** Claim pairs that cannot both be true of the same symbol in the same version. */
const CONTRADICTORY_PAIRS: Array<[string, string]> = [
  ['removed_api', 'new_api'],
  ['removed_api', 'deprecated_api'],
];

function bestProvenance(a: Provenance, b: Provenance): Provenance {
  const rank: Record<Provenance, number> = {
    verified_repository: 0,
    official: 1,
    community: 2,
    agent_generated: 3,
  };
  return rank[a] <= rank[b] ? a : b;
}

function mergeSources(existing: SourceRef[], incoming: SourceRef[]): SourceRef[] {
  const byUrl = new Map(existing.map((source) => [source.url, source]));

  for (const source of incoming) {
    const current = byUrl.get(source.url);
    // Keep whichever copy actually quotes the claim; a citation without a quote
    // cannot be displayed as evidence.
    if (!current || (!current.quotedText && source.quotedText)) byUrl.set(source.url, source);
  }

  return [...byUrl.values()].sort((a, b) => sourcePriority(a.sourceType) - sourcePriority(b.sourceType));
}

function merge(base: KnowledgeObject, incoming: KnowledgeObject): KnowledgeObject {
  const sources = mergeSources(base.sources, incoming.sources);

  // Prefer the description from the more authoritative source.
  const preferIncoming = sourcePriority(incoming.sources[0].sourceType) < sourcePriority(base.sources[0].sourceType);
  const authoritative = preferIncoming ? incoming : base;
  const other = preferIncoming ? base : incoming;

  return {
    ...authoritative,
    id: base.id,
    sources,
    provenance: bestProvenance(base.provenance, incoming.provenance),
    severity: SEVERITY_ORDER[base.severity] <= SEVERITY_ORDER[incoming.severity] ? base.severity : incoming.severity,
    affectedApis: [...new Set([...base.affectedApis, ...incoming.affectedApis])],
    affectedConfig: [...new Set([...base.affectedConfig, ...incoming.affectedConfig])],
    migration: authoritative.migration.length > 0 ? authoritative.migration : other.migration,
    introduced: authoritative.introduced ?? other.introduced,
    fixed: authoritative.fixed ?? other.fixed,
    affected: authoritative.affected ?? other.affected,
    oldBehavior: authoritative.oldBehavior ?? other.oldBehavior,
    newBehavior: authoritative.newBehavior ?? other.newBehavior,
    updatedAt: new Date().toISOString(),
  };
}

function rescore(knowledge: KnowledgeObject, contradicted: boolean): KnowledgeObject {
  const domains = new Set(knowledge.sources.map((source) => source.domain));

  const result = scoreConfidence({
    sourceTypes: knowledge.sources.map((source) => source.sourceType),
    independentDomains: domains.size,
    exactVersionMatch: isInWindow(knowledge.introduced ?? '', knowledge.fromVersion, knowledge.toVersion),
    provenance: knowledge.provenance,
    contradicted,
  });

  return { ...knowledge, confidence: result.score };
}

function contradicts(a: KnowledgeObject, b: KnowledgeObject): boolean {
  if (a.package !== b.package) return false;
  const sharedSymbol = a.affectedApis.some((symbol) => b.affectedApis.includes(symbol));
  if (!sharedSymbol) return false;

  return CONTRADICTORY_PAIRS.some(
    ([left, right]) => (a.type === left && b.type === right) || (a.type === right && b.type === left),
  );
}

export interface DeduplicationResult {
  knowledge: KnowledgeObject[];
  /** Input count minus output count — reported in the research trace. */
  collapsed: number;
  contradictions: Array<{ a: string; b: string }>;
}

export function deduplicate(input: KnowledgeObject[]): DeduplicationResult {
  const merged: KnowledgeObject[] = [];

  for (const candidate of input) {
    const exact = merged.findIndex(
      (existing) => existing.fingerprint === candidate.fingerprint && existing.package === candidate.package,
    );
    if (exact >= 0) {
      merged[exact] = merge(merged[exact], candidate);
      continue;
    }

    const semantic = merged.findIndex(
      (existing) =>
        existing.package === candidate.package &&
        existing.type === candidate.type &&
        tokenSimilarity(existing.description, candidate.description) >= SEMANTIC_DUPLICATE_THRESHOLD,
    );
    if (semantic >= 0) {
      merged[semantic] = merge(merged[semantic], candidate);
      continue;
    }

    merged.push(candidate);
  }

  const contradictions: Array<{ a: string; b: string }> = [];
  const contradicted = new Set<string>();

  for (let i = 0; i < merged.length; i++) {
    for (let j = i + 1; j < merged.length; j++) {
      if (!contradicts(merged[i], merged[j])) continue;
      contradictions.push({ a: merged[i].id, b: merged[j].id });
      contradicted.add(merged[i].id);
      contradicted.add(merged[j].id);
    }
  }

  return {
    knowledge: merged.map((item) => rescore(item, contradicted.has(item.id))),
    collapsed: input.length - merged.length,
    contradictions,
  };
}
