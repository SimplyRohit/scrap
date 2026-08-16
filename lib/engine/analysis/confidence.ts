/**
 * Confidence scoring (gen.md sections 13, 20, 21).
 *
 * The weights are the ones the spec fixes. What the spec leaves implicit and this
 * module makes explicit: agent-generated knowledge cannot reach official
 * confidence on evidence alone — only successful validation raises its ceiling.
 */

import type { Provenance, SourceType } from '../knowledge';

export type ConfidenceCategory = 'Very High' | 'High' | 'Medium' | 'Low' | 'Very Low';

export interface ConfidenceSignals {
  sourceTypes: SourceType[];
  /** Count of distinct domains asserting the same knowledge. */
  independentDomains: number;
  exactErrorMatch?: boolean;
  exactVersionMatch?: boolean;
  validated?: boolean;
  contradicted?: boolean;
  provenance: Provenance;
  /** Repositories beyond the first that confirmed this fix (gen.md section 20). */
  additionalConfirmations?: number;
  /** Times the fix was applied and did not resolve the problem. */
  refutations?: number;
}

export interface ConfidenceContribution {
  label: string;
  delta: number;
}

export interface ConfidenceResult {
  score: number;
  category: ConfidenceCategory;
  contributions: ConfidenceContribution[];
  /** Set when a ceiling clipped the raw score, so the reason is reportable. */
  cappedBy?: string;
}

const SOURCE_WEIGHTS: Partial<Record<SourceType, { label: string; delta: number }>> = {
  official_migration_guide: { label: 'Official migration guide', delta: 0.35 },
  official_docs: { label: 'Official documentation', delta: 0.25 },
  official_changelog: { label: 'Official changelog', delta: 0.25 },
  official_release: { label: 'Official release notes', delta: 0.25 },
  official_commit: { label: 'Official commit', delta: 0.15 },
  official_issue: { label: 'Official GitHub issue', delta: 0.15 },
  package_registry: { label: 'Package registry', delta: 0.15 },
  technical_docs: { label: 'Technical documentation', delta: 0.08 },
  community: { label: 'Community-only source', delta: 0.03 },
  web: { label: 'General web result', delta: 0.02 },
  // Small on purpose: "Successful validation" is scored separately below, and
  // counting the same proof twice would let one green test run outrank the docs.
  verified_fix: { label: 'Verified fix', delta: 0.05 },
};

/** Agent-generated knowledge stays advisory until a test run confirms it. */
const UNVALIDATED_AGENT_CEILING = 0.6;

/**
 * Backstop for validated-but-undocumented knowledge.
 *
 * The weights already hold uncorroborated fixes near 0.40 — well under the
 * assertion threshold — so this rarely binds. It exists so that no future
 * reweighting can let a green test run reach the confidence of documentation.
 */
const VERIFIED_REPOSITORY_CEILING = 0.85;

export function scoreConfidence(signals: ConfidenceSignals): ConfidenceResult {
  const contributions: ConfidenceContribution[] = [];

  // Each source type counts once, at its own weight — five changelog mirrors are
  // not five independent confirmations.
  for (const sourceType of new Set(signals.sourceTypes)) {
    const weight = SOURCE_WEIGHTS[sourceType];
    if (weight) contributions.push(weight);
  }

  if (signals.independentDomains > 1) {
    contributions.push({ label: 'Multiple independent sources', delta: 0.1 });
  }
  if (signals.exactErrorMatch) {
    contributions.push({ label: 'Exact error match', delta: 0.1 });
  }
  if (signals.exactVersionMatch) {
    contributions.push({ label: 'Exact version match', delta: 0.1 });
  }
  if (signals.validated) {
    contributions.push({ label: 'Successful validation', delta: 0.2 });
  }
  if (signals.contradicted) {
    contributions.push({ label: 'Contradicting evidence', delta: -0.2 });
  }

  // Repeated independent confirmation raises confidence, but with diminishing
  // returns — the tenth green test run is worth far less than the second.
  const confirmations = signals.additionalConfirmations ?? 0;
  if (confirmations > 0) {
    contributions.push({
      label: `Confirmed by ${confirmations + 1} repositories`,
      delta: Math.min(0.15, 0.05 * Math.log2(confirmations + 1) * 2),
    });
  }

  // A fix that failed elsewhere is evidence against itself, and it outweighs a
  // single success: a fix that works once and fails twice is not a fix.
  const refutations = signals.refutations ?? 0;
  if (refutations > 0) {
    contributions.push({ label: `Failed in ${refutations} repositories`, delta: -0.15 * refutations });
  }

  const raw = contributions.reduce((total, item) => total + item.delta, 0);
  let score = Math.min(1, Math.max(0, raw));
  let cappedBy: string | undefined;

  if (signals.provenance === 'agent_generated' && !signals.validated && score > UNVALIDATED_AGENT_CEILING) {
    score = UNVALIDATED_AGENT_CEILING;
    cappedBy = 'agent-generated knowledge is capped until validation succeeds';
  }

  // Even a validated fix stays below the top band unless an authoritative source
  // agrees. Passing tests proves it works here, not that it is the intended migration.
  if (signals.provenance === 'verified_repository' && score > VERIFIED_REPOSITORY_CEILING) {
    const hasOfficialAgreement = signals.sourceTypes.some((type) => type.startsWith('official'));
    if (!hasOfficialAgreement) {
      score = VERIFIED_REPOSITORY_CEILING;
      cappedBy = 'repository-verified knowledge is capped without an authoritative source';
    }
  }

  return { score, category: categorize(score), contributions, cappedBy };
}

export function categorize(score: number): ConfidenceCategory {
  if (score >= 0.9) return 'Very High';
  if (score >= 0.75) return 'High';
  if (score >= 0.5) return 'Medium';
  if (score >= 0.25) return 'Low';
  return 'Very Low';
}

/** gen.md section 13: below this, findings are presented as possibilities, not facts. */
export const ASSERTION_THRESHOLD = 0.75;

export function isAssertable(score: number): boolean {
  return score >= ASSERTION_THRESHOLD;
}

export function confidenceCaveat(score: number): string | null {
  if (isAssertable(score)) return null;
  if (score >= 0.5) {
    return 'Confidence: MEDIUM — corroborated, but not by an authoritative source for this exact version.';
  }
  return 'Confidence: LOW — this is a likely cause, but no authoritative source confirms it.';
}
