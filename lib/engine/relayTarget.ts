/**
 * Target validation for the relay's fetch route.
 *
 * The route takes a URL from an anonymous caller and fetches it with our
 * credentials. Handed an unchecked string that is a server-side request forgery
 * primitive: `http://169.254.169.254/` is the cloud metadata endpoint, and
 * `http://localhost:3000/api/...` is the deployment talking to itself. Neither
 * is a documentation page, and neither should ever leave this process.
 *
 * The unlocker route is the safe one — it fetches from Bright Data's network,
 * not ours — but the check lives here rather than there so that no future
 * caller can add a direct fallback and quietly reopen the hole.
 */

/** Hostnames that always mean "this machine" or "this network". */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'metadata.google.internal']);

/**
 * Literal addresses that are not routable on the public internet.
 *
 * Matching on the literal is enough: a hostname that resolves into one of these
 * ranges is a DNS-rebinding attack, and the unlocker fetching it from its own
 * network is what makes that harmless here.
 */
const PRIVATE_IPV4 =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

export interface TargetCheck {
  ok: boolean;
  reason?: string;
}

export function checkRelayTarget(raw: unknown): TargetCheck {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'Provide a `url` string' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'Not a valid absolute URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Unsupported scheme ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: 'Loopback and metadata hosts are not relayed' };
  }
  if (PRIVATE_IPV4.test(hostname)) {
    return { ok: false, reason: 'Private address ranges are not relayed' };
  }
  // ::1, and the ::ffff:10.0.0.1 form that maps an IPv4 private address into v6.
  if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')) {
    return { ok: false, reason: 'Private address ranges are not relayed' };
  }
  if (hostname.startsWith('::ffff:') && PRIVATE_IPV4.test(hostname.slice(7))) {
    return { ok: false, reason: 'Private address ranges are not relayed' };
  }

  return { ok: true };
}
