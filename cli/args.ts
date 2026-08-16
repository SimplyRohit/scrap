/**
 * Minimal argument parsing.
 *
 * A dependency-free parser rather than commander: the CLI's surface is fixed by
 * gen.md section 25, and an arg parser is the kind of thing that is smaller to
 * write than to configure.
 */

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];

    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }

    const name = token.replace(/^--?/, '');
    const [key, inlineValue] = name.split('=');

    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    // A flag followed by another flag is a boolean; `--error -5` would be
    // ambiguous, so a value starting with `-` only counts if it is a negative number.
    if (next === undefined || (next.startsWith('-') && !/^-\d/.test(next))) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index++;
  }

  return { command: positional.shift(), positional, flags };
}

export function stringFlag(flags: ParsedArgs['flags'], ...names: string[]): string | undefined {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

export function boolFlag(flags: ParsedArgs['flags'], ...names: string[]): boolean {
  return names.some((name) => flags[name] === true || flags[name] === 'true');
}

export function numberFlag(flags: ParsedArgs['flags'], ...names: string[]): number | undefined {
  const raw = stringFlag(flags, ...names);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
