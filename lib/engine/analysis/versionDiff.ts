/**
 * Version delta analysis (gen.md section 4) and repository risk aggregation.
 *
 * Risk here is derived from *evidence found*, not from the size of the version
 * jump alone — a major bump with a documented no-op migration is safer than a
 * minor bump that removed an API you call.
 */

import { classifyDelta, isBreakingDelta, isInWindow, type VersionDelta } from '../semver';
import { BREAKING_TYPES, SEVERITY_ORDER, type KnowledgeObject, type Severity } from '../knowledge';
import type { PackageRef } from '../request';

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';

export interface VersionChange {
  package: string;
  fromVersion: string;
  toVersion: string | null;
  delta: VersionDelta;
  breakingByPolicy: boolean;
  dependencyType: PackageRef['dependencyType'];
}

export function describeChange(ref: PackageRef, targetVersion: string | null): VersionChange {
  return {
    package: ref.name,
    fromVersion: ref.currentVersion,
    toVersion: targetVersion,
    delta: targetVersion ? classifyDelta(ref.currentVersion, targetVersion) : 'unknown',
    breakingByPolicy: targetVersion ? isBreakingDelta(ref.currentVersion, targetVersion) : false,
    dependencyType: ref.dependencyType,
  };
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  CRITICAL: 34,
  HIGH: 20,
  MEDIUM: 9,
  LOW: 3,
};

/** Types that describe an actual break rather than an informational change. */
export function isBreaking(knowledge: KnowledgeObject): boolean {
  return BREAKING_TYPES.has(knowledge.type);
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  rationale: string[];
}

/**
 * A changelog carries the project's whole history. A claim anchored to a version
 * outside the requested window is real, but it is not part of *this* upgrade —
 * counting it rates a 3.4 to 4.0 jump on breaking changes from 1.x. Claims with
 * no version anchor inherit the target version upstream, so they are kept.
 */
export function inUpgradeWindow(item: KnowledgeObject): boolean {
  if (!item.introduced) return true;
  return isInWindow(item.introduced, item.fromVersion, item.toVersion);
}

/**
 * Breaking, and part of *this* upgrade. Every report surface filters on this
 * rather than on `isBreaking` alone, so a changelog's back catalogue cannot
 * present itself as work the user has to do now.
 */
export function isBreakingInWindow(item: KnowledgeObject): boolean {
  return isBreaking(item) && inUpgradeWindow(item);
}

/**
 * Low-confidence findings contribute proportionally less: an unconfirmed rumour
 * of a removed API should not drive a CRITICAL rating on its own.
 */
export function assessRisk(change: VersionChange, knowledge: KnowledgeObject[]): RiskAssessment {
  const rationale: string[] = [];
  let score = 0;

  if (change.delta === 'unknown') {
    return { score: 0, level: 'SAFE', rationale: ['No target version could be resolved from the registry.'] };
  }
  if (change.delta === 'none') {
    return { score: 0, level: 'SAFE', rationale: ['Already on the target version.'] };
  }

  if (change.breakingByPolicy) {
    score += 12;
    rationale.push(`${change.delta} version jump — semver permits breaking changes.`);
  }

  const breaking = knowledge.filter(isBreakingInWindow);
  for (const item of breaking) {
    score += SEVERITY_WEIGHT[item.severity] * Math.max(0.35, item.confidence);
  }

  if (breaking.length > 0) {
    const bySeverity = breaking.reduce<Record<string, number>>((counts, item) => {
      counts[item.severity] = (counts[item.severity] ?? 0) + 1;
      return counts;
    }, {});
    rationale.push(
      `${breaking.length} documented breaking change${breaking.length === 1 ? '' : 's'} (${Object.entries(bySeverity)
        .sort(([a], [b]) => SEVERITY_ORDER[a as Severity] - SEVERITY_ORDER[b as Severity])
        .map(([severity, count]) => `${count} ${severity.toLowerCase()}`)
        .join(', ')}).`,
    );
  } else if (change.breakingByPolicy) {
    rationale.push('No breaking changes were found in the sources researched — treat as unverified, not as safe.');
  }

  const rounded = Math.min(100, Math.round(score));
  return { score: rounded, level: levelFor(rounded), rationale };
}

function levelFor(score: number): RiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 55) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'SAFE';
}

export type SafetyRating = 'HIGH_RISK' | 'MODERATE_RISK' | 'LOW_RISK' | 'SAFE_TO_UPGRADE';

export function overallSafety(levels: RiskLevel[]): SafetyRating {
  const count = (level: RiskLevel) => levels.filter((item) => item === level).length;

  if (count('CRITICAL') > 0 || count('HIGH') >= 3) return 'HIGH_RISK';
  if (count('HIGH') > 0 || count('MEDIUM') >= 3) return 'MODERATE_RISK';
  if (count('MEDIUM') > 0 || count('LOW') > 0) return 'LOW_RISK';
  return 'SAFE_TO_UPGRADE';
}
