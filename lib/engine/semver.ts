/**
 * Dependency-free semver subset.
 *
 * We only need: parse, compare, delta classification, and range satisfaction for
 * the range shapes that actually appear in manifests and advisories
 * (`^x.y.z`, `~x.y.z`, `>=a <b`, `x.x`, exact). Adding the `semver` package would
 * buy full spec compliance we do not use.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  raw: string;
}

const SEMVER_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parse(version: string): SemVer | null {
  const match = SEMVER_RE.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    raw: version.trim(),
  };
}

/** Strips range operators to leave a bare version. `^6.0.0` -> `6.0.0`. */
export function coerce(version: string): string {
  return version.replace(/^[\^~><=v\s]+/, '').trim();
}

export function compare(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  // A version with a prerelease tag sorts below the same version without one.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const pa = a.prerelease[i];
    const pb = b.prerelease[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    if (pa === pb) continue;
    const na = Number(pa);
    const nb = Number(pb);
    const bothNumeric = !Number.isNaN(na) && !Number.isNaN(nb);
    if (bothNumeric) return na < nb ? -1 : 1;
    return pa < pb ? -1 : 1;
  }
  return 0;
}

export function compareStrings(a: string, b: string): number {
  const pa = parse(coerce(a));
  const pb = parse(coerce(b));
  if (!pa || !pb) return a.localeCompare(b);
  return compare(pa, pb);
}

export function gt(a: string, b: string): boolean {
  return compareStrings(a, b) > 0;
}

export function lt(a: string, b: string): boolean {
  return compareStrings(a, b) < 0;
}

export function eq(a: string, b: string): boolean {
  return compareStrings(a, b) === 0;
}

export type VersionDelta = 'major' | 'minor' | 'patch' | 'prerelease' | 'none' | 'downgrade' | 'unknown';

/** Classifies the jump from `from` to `to`. Used for risk baselines (gen.md section 4). */
export function classifyDelta(from: string, to: string): VersionDelta {
  const a = parse(coerce(from));
  const b = parse(coerce(to));
  if (!a || !b) return 'unknown';

  const cmp = compare(a, b);
  if (cmp === 0) return 'none';
  if (cmp > 0) return 'downgrade';

  if (a.major !== b.major) return 'major';
  if (a.minor !== b.minor) return 'minor';
  if (a.patch !== b.patch) return 'patch';
  return 'prerelease';
}

/**
 * A 0.x release treats minor bumps as breaking, per the semver spec's caveat for
 * initial development. LangChain 0.0.x -> 0.2.x is a major event, not a minor one.
 */
export function isBreakingDelta(from: string, to: string): boolean {
  const a = parse(coerce(from));
  const b = parse(coerce(to));
  if (!a || !b) return false;
  if (a.major === 0 || b.major === 0) return a.major !== b.major || a.minor !== b.minor;
  return a.major !== b.major;
}

type Comparator = { op: '>' | '>=' | '<' | '<=' | '=' ; version: SemVer };

function parseComparators(range: string): Comparator[] | null {
  const parts = range.trim().split(/\s+/).filter(Boolean);
  const comparators: Comparator[] = [];

  for (const part of parts) {
    if (part === '*' || part === 'x') continue;

    const caretOrTilde = /^([\^~])(.+)$/.exec(part);
    if (caretOrTilde) {
      const base = parse(caretOrTilde[2]);
      if (!base) return null;
      comparators.push({ op: '>=', version: base });
      const upper: SemVer =
        caretOrTilde[1] === '~'
          ? { ...base, minor: base.minor + 1, patch: 0, prerelease: [] }
          : base.major > 0
            ? { ...base, major: base.major + 1, minor: 0, patch: 0, prerelease: [] }
            : { ...base, minor: base.minor + 1, patch: 0, prerelease: [] };
      comparators.push({ op: '<', version: upper });
      continue;
    }

    const explicit = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(part);
    if (!explicit) return null;
    const version = parse(explicit[2]);
    if (!version) return null;
    comparators.push({ op: (explicit[1] as Comparator['op']) ?? '=', version });
  }

  return comparators;
}

/**
 * Range satisfaction. Space-separated comparators are ANDed; `||` alternatives are ORed.
 * Returns false rather than throwing on ranges we cannot parse, so an unparsable
 * advisory range never silently widens a match.
 */
export function satisfies(version: string, range: string): boolean {
  const target = parse(coerce(version));
  if (!target) return false;

  const alternatives = range.split('||');
  return alternatives.some((alternative) => {
    const comparators = parseComparators(alternative);
    if (!comparators) return false;
    if (comparators.length === 0) return true;

    return comparators.every(({ op, version: bound }) => {
      const cmp = compare(target, bound);
      switch (op) {
        case '>':
          return cmp > 0;
        case '>=':
          return cmp >= 0;
        case '<':
          return cmp < 0;
        case '<=':
          return cmp <= 0;
        case '=':
          return cmp === 0;
      }
    });
  });
}

/** Builds the `>=introduced <fixed` range used by knowledge objects (gen.md section 9). */
export function affectedRange(introduced?: string, fixed?: string): string | undefined {
  if (!introduced && !fixed) return undefined;
  if (introduced && fixed) return `>=${coerce(introduced)} <${coerce(fixed)}`;
  if (introduced) return `>=${coerce(introduced)}`;
  return `<${coerce(fixed!)}`;
}

export function sortVersionsAscending(versions: string[]): string[] {
  return [...versions].sort(compareStrings);
}

/** True when `version` falls in the upgrade window `(from, to]`. */
export function isInWindow(version: string, from?: string, to?: string): boolean {
  if (!version) return false;
  if (from && !gt(version, from)) return false;
  if (to && compareStrings(version, to) > 0) return false;
  return Boolean(from || to);
}

/** Versions strictly after `from` and up to and including `to`. */
export function versionsInWindow(versions: string[], from: string, to: string): string[] {
  return sortVersionsAscending(versions).filter((v) => gt(v, from) && compareStrings(v, to) <= 0);
}
