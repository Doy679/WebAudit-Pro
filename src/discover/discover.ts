import { normalizeUrl, isSameSite } from "./normalize.js";
import { parseRobots, isAllowed, type Robots } from "./robots.js";
import { parseSitemap } from "./sitemap.js";
import { samplePages } from "./sample.js";

const MAX_SITEMAPS = 10;
const MAX_SITEMAP_URLS = 5000;

export interface Discovery {
  pages: string[];
  sitemapUrls: string[] | null;
  skipped: { url: string; reason: string }[];
}

async function fetchText(url: string, userAgent: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": userAgent }, signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function readSitemaps(roots: string[], startUrl: string, userAgent: string): Promise<string[] | null> {
  const queue = [...roots];
  const visited = new Set<string>();
  const urls: string[] = [];
  let found = false;
  while (queue.length && visited.size < MAX_SITEMAPS && urls.length < MAX_SITEMAP_URLS) {
    const sm = queue.shift()!;
    if (visited.has(sm)) continue;
    visited.add(sm);
    const xml = await fetchText(sm, userAgent);
    if (!xml || !/<(urlset|sitemapindex)[\s>]/i.test(xml)) continue;
    found = true;
    const { kind, locs } = parseSitemap(xml);
    for (const loc of locs) {
      const u = normalizeUrl(loc);
      if (!u || !isSameSite(u, startUrl)) continue;
      if (kind === "index") queue.push(u);
      else urls.push(u);
    }
  }
  return found ? urls.slice(0, MAX_SITEMAP_URLS) : null;
}

/**
 * Builds the page list: an explicit URL list, or a sample from the sitemap.
 * Same site only, robots.txt respected either way.
 */
export async function discover(opts: { startUrl: string; urls?: string[]; maxPages: number; userAgent: string }): Promise<Discovery> {
  const start = normalizeUrl(opts.startUrl);
  if (!start) throw new Error(`Invalid start URL: ${opts.startUrl}`);
  const origin = new URL(start).origin;

  const robotsTxt = await fetchText(`${origin}/robots.txt`, opts.userAgent);
  const robots: Robots = parseRobots(robotsTxt ?? "");
  const roots = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const sitemapUrls = await readSitemaps(roots, start, opts.userAgent);

  const skipped: Discovery["skipped"] = [];
  const candidates: string[] = [];
  for (const raw of opts.urls ?? sitemapUrls ?? []) {
    const u = normalizeUrl(raw, start);
    if (!u) continue;
    if (!isSameSite(u, start)) skipped.push({ url: u, reason: "different domain" });
    else if (!isAllowed(robots, u)) skipped.push({ url: u, reason: "blocked by robots.txt" });
    else candidates.push(u);
  }

  let pages: string[];
  if (opts.urls) {
    pages = [...new Set(candidates)].slice(0, opts.maxPages);
  } else if (isAllowed(robots, start)) {
    pages = samplePages(start, candidates, opts.maxPages);
  } else {
    skipped.push({ url: start, reason: "blocked by robots.txt" });
    pages = samplePages(candidates[0] ?? start, candidates.slice(1), opts.maxPages).filter((u) => isAllowed(robots, u));
  }
  return { pages, sitemapUrls, skipped };
}
