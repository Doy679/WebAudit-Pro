import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {}

export interface SsrfPolicy {
  /** Test-only: allow 127.0.0.0/8 and ::1 (local fixture sites). Never enabled in production. */
  allowLoopback?: boolean;
}

/** Policy from the environment: loopback only when WEBAUDIT_TEST_ALLOW_LOOPBACK=1 is set explicitly. */
export const envPolicy = (): SsrfPolicy => ({ allowLoopback: process.env.WEBAUDIT_TEST_ALLOW_LOOPBACK === "1" });

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

const v4ToInt = (ip: string) => ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const inV4 = (ip: string, base: string, bits: number) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};

function expandV6(ip: string): number[] {
  // Handles "::" compression and an embedded IPv4 tail; returns 8 16-bit groups.
  let tail: number[] = [];
  const v4 = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4ToInt(v4[1]);
    tail = [n >>> 16, n & 0xffff];
    ip = ip.slice(0, -v4[1].length).replace(/:$/, "") || ":";
    if (ip.endsWith(":") && !ip.endsWith("::")) ip = ip.slice(0, -1);
  }
  const [head, rest] = ip.includes("::") ? ip.split("::") : [ip, undefined];
  const h = head ? head.split(":").filter(Boolean).map((g) => parseInt(g, 16)) : [];
  const r = rest !== undefined && rest ? rest.split(":").filter(Boolean).map((g) => parseInt(g, 16)) : [];
  const fill = 8 - h.length - r.length - tail.length;
  return [...h, ...(rest !== undefined ? Array(Math.max(0, fill)).fill(0) : []), ...r, ...tail];
}

export function isLoopback(ip: string): boolean {
  if (isIP(ip) === 4) return inV4(ip, "127.0.0.0", 8);
  const g = expandV6(ip);
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return inV4(`${g[6] >>> 8}.${g[6] & 255}.${g[7] >>> 8}.${g[7] & 255}`, "127.0.0.0", 8);
  return false;
}

/** True for any address a public-web audit must never reach: private, loopback, link-local, metadata, multicast, reserved. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return V4_BLOCKED.some(([base, bits]) => inV4(ip, base, bits)) || ip === "255.255.255.255";
  if (version !== 6) return true;
  const g = expandV6(ip.toLowerCase());
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isBlockedIp(`${g[6] >>> 8}.${g[6] & 255}.${g[7] >>> 8}.${g[7] & 255}`); // IPv4-mapped
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 can reach IPv4 internals
  return false;
}

const allowed = (ip: string, policy: SsrfPolicy) => !isBlockedIp(ip) || (!!policy.allowLoopback && isLoopback(ip));

/** Resolves every address for the host; throws UnsafeUrlError if any is not allowed. */
export async function assertPublicHost(hostname: string, policy: SsrfPolicy = {}): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new UnsafeUrlError(`Could not resolve ${hostname}`);
  const bad = addresses.find((a) => !allowed(a, policy));
  if (bad) throw new UnsafeUrlError(`${hostname} resolves to a private or reserved address (${bad}); internal networks cannot be audited.`);
  return addresses;
}

/** Validates scheme, credentials and resolved addresses of a URL before any request is made. */
export async function assertPublicUrl(raw: string, policy: SsrfPolicy = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http and https URLs can be audited.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  await assertPublicHost(url.hostname, policy);
  return url;
}

/** Per-host verdict cache for checking every browser request (short TTL limits DNS-rebinding windows). */
export class HostGuard {
  private cache = new Map<string, { ok: boolean; at: number }>();
  constructor(private policy: SsrfPolicy = {}, private ttlMs = 30_000) {}

  async allows(rawUrl: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return true;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hit = this.cache.get(url.hostname);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.ok;
    const ok = await assertPublicHost(url.hostname, this.policy).then(() => true, () => false);
    this.cache.set(url.hostname, { ok, at: Date.now() });
    return ok;
  }
}

/**
 * fetch() that validates the target and every redirect hop. GET/HEAD only (read-only audits).
 */
export async function guardedFetch(
  raw: string,
  init: { method?: "GET" | "HEAD"; headers?: Record<string, string>; timeoutMs?: number } = {},
  policy: SsrfPolicy = {},
  maxRedirects = 5,
): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current, policy);
    const res = await fetch(current, {
      method: init.method ?? "GET",
      headers: init.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError(`Too many redirects from ${raw}`);
}
