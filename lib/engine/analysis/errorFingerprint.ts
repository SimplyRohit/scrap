/**
 * Error fingerprinting (gen.md section 7).
 *
 * Searching the raw error string is nearly useless: it carries absolute paths,
 * generated ids, and line numbers unique to one machine and one run. Fingerprinting
 * strips everything run-specific so that two developers hitting the same bug in
 * different repositories map to the same knowledge.
 */

import { shortHash } from '../hash';
import type { ErrorFingerprint } from '../knowledge';

/**
 * Order matters: broader patterns (URLs, absolute paths) run before narrower ones
 * (line numbers, hex) so a path's digits are not mistaken for a line number.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  [/https?:\/\/[^\s'")\]]+/g, '<url>'],
  [/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'")\]]+/gi, '<connection-string>'],
  // Absolute POSIX and Windows paths, including the drive letter form.
  [/(?:[A-Za-z]:)?[\\/](?:[\w.@~-]+[\\/])+[\w.@-]+/g, '<path>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b0x[0-9a-f]{4,}\b/gi, '<address>'],
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<timestamp>'],
  [/\b\d{10,13}\b/g, '<epoch>'],
  // Long opaque tokens: hashes, request ids, base64 fragments.
  [/\b[0-9a-f]{16,}\b/gi, '<hash>'],
  [/\b[A-Za-z0-9_-]{24,}\b/g, '<token>'],
  [/:\d+:\d+\b/g, ':<line>:<col>'],
  [/\bline \d+\b/gi, 'line <line>'],
  [/\b\d+ms\b/g, '<duration>'],
];

export function normalizeErrorText(text: string): string {
  let normalized = text;
  for (const [pattern, replacement] of REDACTIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

/**
 * The error class name. Recognises the JS `SomeError: message` convention, Python
 * tracebacks, and bracketed codes like `[PrismaClientKnownRequestError]`.
 */
export function extractErrorType(text: string): string {
  // The name prefix is optional so a bare `Error:` / `Exception:` still resolves.
  // Qualified and bracketed forms are tried first because they are more specific.
  const patterns = [
    /(?:^|\n)([a-z_.]+\.[A-Z][A-Za-z0-9_]*(?:Error|Exception))\s*:/,
    /\[((?:[A-Z][A-Za-z0-9_]*)?(?:Error|Exception))\]/,
    /(?:^|\n)\s*((?:[A-Z][A-Za-z0-9_]*)?(?:Error|Exception|Fault|Warning))\s*(?::|\n|$)/,
    /\b([A-Z][A-Za-z0-9_]{2,}(?:Error|Exception))\b/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return 'UnknownError';
}

/** Machine-readable codes: `ERR_MODULE_NOT_FOUND`, `ENOENT`, `P2002`, `TS2345`. */
export function extractErrorCode(text: string): string | undefined {
  const patterns = [
    /\bcode:\s*['"]?([A-Z][A-Z0-9_]{2,})['"]?/,
    /\b(ERR_[A-Z0-9_]+)\b/,
    /\b(E[A-Z]{3,10})\b/,
    /\b([A-Z]\d{4})\b/,
    /\b(TS\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * The human message, without the type prefix or the stack. Only the first frame
 * boundary is considered — everything after it is stack, not message.
 */
export function extractMessage(text: string, errorType: string): string {
  const firstFrame = text.search(/\n\s*(at\s|File "|\s{2,}at\s)/);
  const head = (firstFrame > 0 ? text.slice(0, firstFrame) : text).trim();

  const typePrefix = new RegExp(`^.*?${errorType}\\s*:?\\s*`, 's');
  const withoutType = head.replace(typePrefix, '').trim();

  return (withoutType || head).split('\n')[0].trim();
}

export interface StackFrame {
  symbol: string;
  file?: string;
  /** True when the frame lives inside the package under investigation. */
  inPackage: boolean;
}

const FRAME_PATTERNS = [
  /\bat\s+(?:async\s+)?([\w$.<>[\]]+)\s*\(([^)]*)\)/g, // V8: at Object.foo (/path:1:2)
  /\bat\s+(?:async\s+)?([\w$.<>[\]]+)\s*$/gm, // V8 without a location
  /File "([^"]+)", line \d+, in ([\w$.]+)/g, // CPython traceback
];

const NOISE_SYMBOL = /^(Object|Module|Function|<anonymous>|new|process|Array)$/;

/** Does this frame's file belong to the package we are diagnosing? */
function isPackageFrame(file: string | undefined, packageName: string): boolean {
  if (!file) return false;
  const name = packageName.toLowerCase().replace(/^@[^/]+\//, '');
  const path = file.toLowerCase();

  return (
    path.includes(`node_modules/${packageName.toLowerCase()}/`) ||
    path.includes(`node_modules/${name}/`) ||
    path.includes(`site-packages/${name}/`) ||
    path.includes(`dist-packages/${name}/`) ||
    // Bundled/monorepo layouts still name the package directory.
    new RegExp(`[\\\\/]${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[\\\\/]`).test(path)
  );
}

/** Parsed frames, nearest first, tagged by whether they are inside the package. */
export function extractStackFrames(text: string, packageName: string, limit = 12): StackFrame[] {
  const frames: StackFrame[] = [];

  const push = (symbol: string | undefined, file: string | undefined) => {
    if (!symbol || symbol.length < 2 || NOISE_SYMBOL.test(symbol)) return;
    if (frames.some((frame) => frame.symbol === symbol)) return;
    frames.push({ symbol, file, inPackage: isPackageFrame(file, packageName) });
  };

  for (const match of text.matchAll(FRAME_PATTERNS[0])) push(match[1], match[2]);
  for (const match of text.matchAll(FRAME_PATTERNS[1])) push(match[1], undefined);
  for (const match of text.matchAll(FRAME_PATTERNS[2])) push(match[2], match[1]);

  return frames.slice(0, limit);
}

export function extractStackSymbols(text: string, packageName = '', limit = 8): string[] {
  return extractStackFrames(text, packageName, limit).map((frame) => frame.symbol);
}

export interface FingerprintInput {
  package: string;
  version?: string;
  error: string;
  stackTrace?: string;
  environment?: Record<string, string>;
}

export function fingerprintError(input: FingerprintInput): ErrorFingerprint {
  const combined = [input.error, input.stackTrace].filter(Boolean).join('\n');

  const errorType = extractErrorType(combined);
  const message = extractMessage(input.error, errorType);
  const normalizedMessage = normalizeErrorText(message);

  const frames = extractStackFrames(combined, input.package);
  const stackSymbols = frames.map((frame) => frame.symbol);

  // Only package-internal frames enter the fingerprint. Application frames are
  // per-repository, so including them would give two developers hitting the same
  // library bug two different fingerprints — see the smoke case in this module's
  // header. When no frame can be attributed to the package, fall back to the
  // message alone rather than fingerprinting on someone's directory layout.
  const identifyingFrames = frames.filter((frame) => frame.inPackage).map((frame) => frame.symbol);

  // The version is deliberately excluded: the same defect spans a version range,
  // and folding the version in would fragment knowledge across patch releases.
  const fingerprint = shortHash(
    [input.package.toLowerCase(), errorType, normalizedMessage, identifyingFrames.slice(0, 3).join('>')].join('|'),
    20,
  );

  return {
    package: input.package,
    packageVersion: input.version,
    errorType,
    errorCode: extractErrorCode(combined),
    message,
    normalizedMessage,
    stackSymbols,
    environment: input.environment ?? {},
    fingerprint,
  };
}

/** Search text for retrieval: the parts of the error that are portable across machines. */
export function retrievalText(fingerprint: ErrorFingerprint): string {
  return [
    fingerprint.errorType,
    fingerprint.errorCode,
    fingerprint.normalizedMessage,
    ...fingerprint.stackSymbols.slice(0, 4),
  ]
    .filter(Boolean)
    .join(' ');
}
