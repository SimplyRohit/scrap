import { describe, expect, test } from 'bun:test';

import { boolFlag, numberFlag, parseArgs, stringFlag } from '../args';

describe('parseArgs', () => {
  test('separates the command from positionals and flags', () => {
    const result = parseArgs(['migrate', 'prisma', '--from', '5.22.0', '--to', '6.0.0']);

    expect(result.command).toBe('migrate');
    expect(result.positional).toEqual(['prisma']);
    expect(result.flags).toMatchObject({ from: '5.22.0', to: '6.0.0' });
  });

  test('accepts inline values', () => {
    expect(parseArgs(['repo', '--fail-on=HIGH']).flags['fail-on']).toBe('HIGH');
  });

  test('treats a flag with no value as boolean', () => {
    const result = parseArgs(['repo', '--json', '--refresh']);
    expect(result.flags.json).toBe(true);
    expect(result.flags.refresh).toBe(true);
  });

  test('keeps an error message that begins with a dash out of the flag stream', () => {
    // `--error "-- foo"` must not be read as another flag.
    const result = parseArgs(['error', '--package', 'demo', '--error', '-5 is invalid']);
    expect(result.flags.error).toBe('-5 is invalid');
  });

  test('preserves values containing spaces and punctuation', () => {
    const message = 'PrismaClientInitializationError: Environment variable not found: DATABASE_URL.';
    expect(parseArgs(['error', '--error', message]).flags.error).toBe(message);
  });

  test('handles short forms', () => {
    expect(parseArgs(['error', '-p', 'demo']).flags.p).toBe('demo');
  });
});

describe('flag readers', () => {
  test('stringFlag falls back through aliases', () => {
    const { flags } = parseArgs(['error', '--package', 'demo']);
    expect(stringFlag(flags, 'p', 'package')).toBe('demo');
    expect(stringFlag(flags, 'missing')).toBeUndefined();
  });

  test('stringFlag ignores a boolean flag', () => {
    const { flags } = parseArgs(['error', '--package']);
    expect(stringFlag(flags, 'package')).toBeUndefined();
  });

  test('boolFlag accepts the bare form and an explicit true', () => {
    expect(boolFlag(parseArgs(['x', '--json']).flags, 'json')).toBe(true);
    expect(boolFlag(parseArgs(['x', '--json=true']).flags, 'json')).toBe(true);
    expect(boolFlag(parseArgs(['x']).flags, 'json')).toBe(false);
  });

  test('numberFlag rejects non-numbers instead of yielding NaN', () => {
    expect(numberFlag(parseArgs(['x', '--max-documents', '4']).flags, 'max-documents')).toBe(4);
    expect(numberFlag(parseArgs(['x', '--max-documents', 'lots']).flags, 'max-documents')).toBeUndefined();
  });
});
