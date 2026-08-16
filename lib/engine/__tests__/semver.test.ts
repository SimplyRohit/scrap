import { describe, expect, test } from 'bun:test';

import {
  affectedRange,
  classifyDelta,
  compareStrings,
  coerce,
  isBreakingDelta,
  isInWindow,
  parse,
  satisfies,
  versionsInWindow,
} from '../semver';

describe('parse', () => {
  test('fills in omitted minor and patch', () => {
    expect(parse('2')).toMatchObject({ major: 2, minor: 0, patch: 0 });
    expect(parse('2.0')).toMatchObject({ major: 2, minor: 0, patch: 0 });
  });

  test('accepts a v prefix and build metadata', () => {
    expect(parse('v1.2.3+build.5')).toMatchObject({ major: 1, minor: 2, patch: 3 });
  });

  test('rejects non-versions rather than coercing them', () => {
    expect(parse('latest')).toBeNull();
    expect(parse('')).toBeNull();
  });
});

describe('compareStrings', () => {
  test('orders by precedence, not lexically', () => {
    // The bug this guards: string sort puts "10.0.0" before "9.0.0".
    expect(compareStrings('9.0.0', '10.0.0')).toBeLessThan(0);
  });

  test('sorts a prerelease below its release', () => {
    expect(compareStrings('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareStrings('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
  });
});

describe('classifyDelta', () => {
  test('names the level of the jump', () => {
    expect(classifyDelta('1.2.3', '2.0.0')).toBe('major');
    expect(classifyDelta('1.2.3', '1.3.0')).toBe('minor');
    expect(classifyDelta('1.2.3', '1.2.4')).toBe('patch');
    expect(classifyDelta('1.2.3', '1.2.3')).toBe('none');
    expect(classifyDelta('2.0.0', '1.0.0')).toBe('downgrade');
    expect(classifyDelta('1.2.3', 'nonsense')).toBe('unknown');
  });
});

describe('isBreakingDelta', () => {
  test('treats a 0.x minor bump as breaking', () => {
    // LangChain 0.0.350 -> 0.2.11 is a major event even though major stays 0.
    expect(isBreakingDelta('0.0.350', '0.2.11')).toBe(true);
    expect(isBreakingDelta('0.2.1', '0.2.9')).toBe(false);
  });

  test('treats a 1.x minor bump as non-breaking', () => {
    expect(isBreakingDelta('1.2.0', '1.9.0')).toBe(false);
    expect(isBreakingDelta('1.2.0', '2.0.0')).toBe(true);
  });
});

describe('satisfies', () => {
  test('handles the advisory range form', () => {
    expect(satisfies('6.1.0', '>=6.0.0 <6.2.1')).toBe(true);
    expect(satisfies('6.2.1', '>=6.0.0 <6.2.1')).toBe(false);
    expect(satisfies('5.9.0', '>=6.0.0 <6.2.1')).toBe(false);
  });

  test('handles caret and tilde', () => {
    expect(satisfies('1.9.0', '^1.2.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfies('0.3.0', '^0.2.0')).toBe(false); // 0.x caret is minor-locked
    expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
  });

  test('ORs alternatives', () => {
    expect(satisfies('3.0.0', '^1.0.0 || ^3.0.0')).toBe(true);
  });

  test('returns false for an unparsable range instead of matching everything', () => {
    // A range we cannot read must never silently widen a match.
    expect(satisfies('1.0.0', 'not-a-range')).toBe(false);
  });
});

describe('isInWindow', () => {
  test('is exclusive of from and inclusive of to', () => {
    expect(isInWindow('15.0.0', '13.4.19', '15.0.0')).toBe(true);
    expect(isInWindow('13.4.19', '13.4.19', '15.0.0')).toBe(false);
    expect(isInWindow('15.0.1', '13.4.19', '15.0.0')).toBe(false);
  });

  test('is false when no bounds are given', () => {
    expect(isInWindow('1.0.0')).toBe(false);
  });
});

describe('affectedRange', () => {
  test('builds the range knowledge objects carry', () => {
    expect(affectedRange('6.0.0', '6.2.1')).toBe('>=6.0.0 <6.2.1');
    expect(affectedRange('6.0.0')).toBe('>=6.0.0');
    expect(affectedRange(undefined, '6.2.1')).toBe('<6.2.1');
    expect(affectedRange()).toBeUndefined();
  });
});

describe('versionsInWindow', () => {
  test('selects the releases an upgrade actually crosses', () => {
    const versions = ['0.9.0', '1.0.0', '1.1.0', '2.0.0'];
    expect(versionsInWindow(versions, '0.9.0', '1.1.0')).toEqual(['1.0.0', '1.1.0']);
  });
});

describe('coerce', () => {
  test('strips range operators', () => {
    expect(coerce('^6.0.0')).toBe('6.0.0');
    expect(coerce('>=1.2.3')).toBe('1.2.3');
    expect(coerce('v2.0.0')).toBe('2.0.0');
  });
});
