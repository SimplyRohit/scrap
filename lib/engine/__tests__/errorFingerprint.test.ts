import { describe, expect, test } from 'bun:test';

import {
  extractErrorCode,
  extractErrorType,
  extractMessage,
  extractStackFrames,
  fingerprintError,
  normalizeErrorText,
} from '../analysis/errorFingerprint';

describe('normalizeErrorText', () => {
  test('redacts everything that varies per machine and per run', () => {
    const normalized = normalizeErrorText(
      'failed at /Users/rohit/app/src/db.ts:42:15 req 550e8400-e29b-41d4-a716-446655440000 at 0xdeadbeef on 2026-08-16T10:00:00Z took 1200ms',
    );

    expect(normalized).not.toContain('/Users/rohit');
    expect(normalized).not.toContain('550e8400');
    expect(normalized).not.toContain('0xdeadbeef');
    expect(normalized).not.toContain('2026-08-16');
    expect(normalized).toContain('<path>');
    expect(normalized).toContain('<uuid>');
  });

  test('leaves the meaningful part of the message intact', () => {
    expect(normalizeErrorText('Environment variable not found: DATABASE_URL.')).toBe(
      'Environment variable not found: DATABASE_URL.',
    );
  });
});

describe('extractErrorType', () => {
  test('reads a named error class', () => {
    expect(extractErrorType('PrismaClientInitializationError: boom')).toBe('PrismaClientInitializationError');
  });

  test('reads a bare Error prefix', () => {
    // Regression: the original patterns required a name before "Error", so every
    // plain `Error:` fingerprinted as UnknownError.
    expect(extractErrorType('Error: params should be awaited')).toBe('Error');
  });

  test('reads a qualified Python exception', () => {
    expect(extractErrorType('pydantic.errors.PydanticUserError: `regex` is removed')).toBe(
      'pydantic.errors.PydanticUserError',
    );
  });

  test('falls back rather than throwing', () => {
    expect(extractErrorType('something went wrong')).toBe('UnknownError');
  });
});

describe('extractErrorCode', () => {
  test('finds machine-readable codes', () => {
    expect(extractErrorCode("code: 'ERR_MODULE_NOT_FOUND'")).toBe('ERR_MODULE_NOT_FOUND');
    expect(extractErrorCode('Unique constraint failed (P2002)')).toBe('P2002');
    expect(extractErrorCode('TS2345: Argument of type')).toBe('TS2345');
    expect(extractErrorCode('no code here')).toBeUndefined();
  });
});

describe('extractMessage', () => {
  test('drops the type prefix and stops at the stack', () => {
    const message = extractMessage(
      'TypeError: foo is not a function\n    at bar (/app/x.ts:1:1)\n    at baz (/app/y.ts:2:2)',
      'TypeError',
    );
    expect(message).toBe('foo is not a function');
  });
});

describe('extractStackFrames', () => {
  const trace = [
    'at async Object.findMany (/app/node_modules/@prisma/client/runtime/library.js:121:9)',
    'at handler (/app/src/api/users.ts:8:22)',
  ].join('\n');

  test('tags frames inside the package under investigation', () => {
    const frames = extractStackFrames(trace, '@prisma/client');
    expect(frames.find((frame) => frame.symbol === 'Object.findMany')?.inPackage).toBe(true);
    expect(frames.find((frame) => frame.symbol === 'handler')?.inPackage).toBe(false);
  });

  test('parses Python tracebacks', () => {
    const frames = extractStackFrames('File "/usr/lib/site-packages/pydantic/main.py", line 12, in validate', 'pydantic');
    expect(frames[0]).toMatchObject({ symbol: 'validate', inPackage: true });
  });
});

describe('fingerprintError', () => {
  const forMachine = (root: string, version: string) =>
    fingerprintError({
      package: 'prisma',
      version,
      error: `PrismaClientInitializationError: Invalid invocation in ${root}/src/db/client.ts:42:15`,
      stackTrace: `at async Object.findMany (${root}/node_modules/prisma/runtime/library.js:121:9)\n    at handler (${root}/src/api/users.ts:8:22)`,
    });

  test('is stable across machines and patch versions', () => {
    // The whole point of section 7: two developers hitting the same library bug
    // must land on the same knowledge.
    expect(forMachine('/Users/rohit/app', '6.0.0').fingerprint).toBe(
      forMachine('/home/ci/build', '6.0.2').fingerprint,
    );
  });

  test('separates genuinely different errors', () => {
    const other = fingerprintError({
      package: 'prisma',
      error: 'PrismaClientKnownRequestError: Unique constraint failed',
    });
    expect(other.fingerprint).not.toBe(forMachine('/app', '6.0.0').fingerprint);
  });

  test('keeps the reported version out of the fingerprint but on the record', () => {
    // A defect spans a range; folding the version in would fragment it per patch.
    const result = forMachine('/app', '6.0.0');
    expect(result.packageVersion).toBe('6.0.0');
    expect(result.fingerprint).toBe(forMachine('/app', '6.9.9').fingerprint);
  });
});
