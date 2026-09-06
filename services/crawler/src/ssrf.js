import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata.google.internal', 'metadata', 'instance-data',
]);

const BLOCKED_TLDS = ['.local', '.internal', '.localhost', '.home.arpa'];

/** RFC1918 + loopback + link-local + CGNAT + benchmarking + reserved. */
function isBlockedIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  if (a === 0) return true;                       // "this" network
  if (a === 10) return true;                      // private
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local + AWS/GCP metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;          // IETF protocol assignments
  if (a === 192 && b === 88) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
  if (a >= 224) return true;                      // multicast + reserved + broadcast
  return false;
}

function isBlockedIPv6(ip) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('fe80')) return true;          // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
  if (s.startsWith('ff')) return true;            // multicast
  // IPv4-mapped ::ffff:a.b.c.d
  const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

export function isBlockedIP(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedIPv4(ip);
  if (v === 6) return isBlockedIPv6(ip);
  return true;
}

export class SSRFError extends Error {
  constructor(message) { super(message); this.name = 'SSRFError'; this.code = 'INVALID_URL'; }
}

/**
 * Validate a URL for outbound fetching. Resolves DNS and checks EVERY
 * returned address, so a hostname that resolves to 127.0.0.1 is rejected
 * even though the hostname itself looks public.
 */
export async function assertSafeUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new SSRFError(`Malformed URL: ${rawUrl}`); }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SSRFError(`Only http/https are allowed, got ${u.protocol}`);
  }
  if (u.username || u.password) throw new SSRFError('URLs with embedded credentials are not allowed');

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host)) throw new SSRFError(`Blocked hostname: ${host}`);
  if (BLOCKED_TLDS.some((t) => host.endsWith(t))) throw new SSRFError(`Blocked internal TLD: ${host}`);

  if (net.isIP(host)) {
    if (isBlockedIP(host)) throw new SSRFError(`Blocked IP address: ${host}`);
    return u;
  }

  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (e) {
    throw new SSRFError(`DNS resolution failed for ${host}: ${e.code ?? e.message}`);
  }
  if (!addrs.length) throw new SSRFError(`No addresses for ${host}`);
  for (const a of addrs) {
    if (isBlockedIP(a.address)) throw new SSRFError(`${host} resolves to blocked address ${a.address}`);
  }
  return u;
}

/** Guard applied to every redirect hop, not just the seed URL. */
export async function assertSafeRedirectChain(response) {
  const chain = [];
  let r = response;
  while (r) {
    chain.push(r.url());
    r = r.request().redirectedFrom()?.response ? await r.request().redirectedFrom().response() : null;
    if (chain.length > 12) break;
  }
  for (const url of chain) await assertSafeUrl(url);
  return chain;
}
