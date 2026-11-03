const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl)$/i;

/** Absolute, lowercase host, no fragment, no tracking params. Null for non-http(s) links. */
export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

const bareHost = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");

export function isSameSite(url: string, startUrl: string): boolean {
  try {
    return bareHost(url) === bareHost(startUrl);
  } catch {
    return false;
  }
}
