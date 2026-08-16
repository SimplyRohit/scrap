import { describe, expect, test } from 'bun:test';

import { categorize, confidenceCaveat, isAssertable, scoreConfidence } from '../analysis/confidence';

describe('the gen.md section 21 table', () => {
  test('applies the documented weights', () => {
    const result = scoreConfidence({
      sourceTypes: ['official_migration_guide'],
      independentDomains: 1,
      provenance: 'official',
    });
    expect(result.score).toBeCloseTo(0.35, 5);
  });

  test('counts each source type once, not each source', () => {
    // Five changelog mirrors are not five independent confirmations.
    const once = scoreConfidence({
      sourceTypes: ['official_changelog'],
      independentDomains: 1,
      provenance: 'official',
    });
    const repeated = scoreConfidence({
      sourceTypes: ['official_changelog', 'official_changelog', 'official_changelog'],
      independentDomains: 1,
      provenance: 'official',
    });
    expect(repeated.score).toBe(once.score);
  });

  test('stacks independent signals', () => {
    const result = scoreConfidence({
      sourceTypes: ['official_migration_guide', 'official_issue'],
      independentDomains: 2,
      exactErrorMatch: true,
      exactVersionMatch: true,
      provenance: 'official',
    });
    // 0.35 + 0.15 + 0.10 + 0.10 + 0.10
    expect(result.score).toBeCloseTo(0.8, 5);
  });

  test('subtracts for contradiction and clamps at zero', () => {
    const result = scoreConfidence({
      sourceTypes: ['community'],
      independentDomains: 1,
      contradicted: true,
      provenance: 'community',
    });
    expect(result.score).toBe(0);
  });
});

describe('provenance ceilings', () => {
  test('caps unvalidated agent knowledge', () => {
    const result = scoreConfidence({
      sourceTypes: ['official_migration_guide', 'official_docs'],
      independentDomains: 3,
      exactErrorMatch: true,
      exactVersionMatch: true,
      provenance: 'agent_generated',
    });

    expect(result.score).toBe(0.6);
    expect(result.cappedBy).toContain('agent-generated');
  });

  test('never lets an uncorroborated fix become assertable, however often it is confirmed', () => {
    // Passing tests prove a change works here, not that it is the intended
    // migration. The weights alone hold this well under the 0.75 assertion
    // threshold; the 0.85 ceiling is a backstop, not the binding constraint.
    const result = scoreConfidence({
      sourceTypes: ['verified_fix'],
      independentDomains: 1,
      validated: true,
      additionalConfirmations: 20,
      provenance: 'verified_repository',
    });

    expect(isAssertable(result.score)).toBe(false);
    expect(result.score).toBeLessThanOrEqual(0.85);
  });

  test('lifts the ceiling once documentation agrees', () => {
    const result = scoreConfidence({
      sourceTypes: ['verified_fix', 'official_migration_guide'],
      independentDomains: 2,
      validated: true,
      exactErrorMatch: true,
      exactVersionMatch: true,
      additionalConfirmations: 3,
      provenance: 'verified_repository',
    });

    expect(result.score).toBeGreaterThan(0.85);
    expect(result.cappedBy).toBeUndefined();
  });
});

describe('confirmations and refutations', () => {
  test('confirmations have diminishing returns', () => {
    const score = (confirmations: number) =>
      scoreConfidence({
        sourceTypes: ['verified_fix'],
        independentDomains: 1,
        validated: true,
        provenance: 'verified_repository',
        additionalConfirmations: confirmations,
      }).score;

    const firstStep = score(1) - score(0);
    const laterStep = score(8) - score(7);
    expect(firstStep).toBeGreaterThan(laterStep);
  });

  test('refutations outweigh a single success', () => {
    // A fix that works once and fails twice is not a fix.
    const contested = scoreConfidence({
      sourceTypes: ['verified_fix'],
      independentDomains: 1,
      validated: true,
      provenance: 'verified_repository',
      additionalConfirmations: 0,
      refutations: 2,
    });
    const clean = scoreConfidence({
      sourceTypes: ['verified_fix'],
      independentDomains: 1,
      validated: true,
      provenance: 'verified_repository',
    });

    expect(contested.score).toBeLessThan(clean.score);
  });
});

describe('presentation', () => {
  test('bands scores as documented', () => {
    expect(categorize(0.95)).toBe('Very High');
    expect(categorize(0.8)).toBe('High');
    expect(categorize(0.6)).toBe('Medium');
    expect(categorize(0.3)).toBe('Low');
    expect(categorize(0.1)).toBe('Very Low');
  });

  test('withholds assertion below the threshold', () => {
    expect(isAssertable(0.75)).toBe(true);
    expect(isAssertable(0.74)).toBe(false);
    expect(confidenceCaveat(0.9)).toBeNull();
    expect(confidenceCaveat(0.3)).toContain('no authoritative source');
  });
});
