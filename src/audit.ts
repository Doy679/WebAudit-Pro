import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Issue, PageSnapshot, RawIssue, Tokens } from "./types.js";
import { discover } from "./discover/discover.js";
import { isAllowed } from "./discover/robots.js";
import { normalizeUrl } from "./discover/normalize.js";
import { Capturer, saveSnapshot } from "./capture/capture.js";
import { buildBaseline } from "./baseline/spacing.js";
import { layoutChecks } from "./checks/layout.js";
import { buttonChecks } from "./checks/buttons.js";
import { typographyChecks } from "./checks/typography.js";
import { spacingChecks } from "./checks/spacing.js";
import { seoChecks, siteSeoChecks } from "./checks/seo.js";
import { a11yIssues, type AxeLike } from "./checks/a11y.js";
import { contentChecks } from "./checks/content.js";
import { navigationChecks, brokenLinkIssues, type LinkResult } from "./checks/site.js";
import { componentChecks } from "./checks/components.js";
import { dedupeAndNumber } from "./report/dedupe.js";
import { annotate } from "./report/annotate.js";
import { renderReport } from "./report/html.js";
import { assertPublicUrl, guardedFetch, type SsrfPolicy } from "./security/ssrf.js";

export interface AuditProgress {
  phase: "discovering" | "scanning" | "checking-links" | "analyzing" | "annotating" | "writing" | "done";
  pagesTotal: number;
  pagesDone: number;
  pagesFailed: number;
  pagesSkipped: number;
  currentUrl?: string;
  currentViewport?: number;
  /** Raw per-viewport findings so far (before grouping). */
  findings: number;
}

export class AuditCancelledError extends Error {
  constructor() {
    super("Audit cancelled");
  }
}

export interface AuditOptions {
  startUrl: string;
  urls?: string[];
  maxPages?: number;
  outDir: string;
  /** Exact run directory (the web app uses data/runs/<runId>); defaults to outDir/<host>/<timestamp>. */
  runDir?: string;
  tokens: Tokens;
  /** Rule groups to run; default all. */
  categories?: string[];
  policy?: SsrfPolicy;
  log?: (msg: string) => void;
  onProgress?: (p: AuditProgress) => void | Promise<void>;
  shouldCancel?: () => boolean | Promise<boolean>;
}

export interface PageResult {
  url: string;
  ok: boolean;
  status: number;
  error?: string;
}

export interface AuditResult {
  runDir: string;
  issues: Issue[];
  summary: { pages: PageResult[]; skipped: { url: string; reason: string }[]; linksChecked: number };
}

export const CATEGORIES = ["layout", "buttons", "typography", "spacing", "a11y", "seo", "content", "navigation", "consistency"] as const;

/** Short, readable, unique folder name per URL: "home", "loans-fha-3f2a1c". */
export function slugFor(url: string): string {
  const u = new URL(url);
  const base = (u.pathname + u.search).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60);
  if (!base) return "home";
  return `${base}-${createHash("sha1").update(url).digest("hex").slice(0, 6)}`;
}

const isOk = (s: PageSnapshot) => s.meta.status > 0 && s.meta.status < 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Raw findings that only need one snapshot (computed as soon as a page is captured). */
function perSnapshotIssues(s: PageSnapshot, tokens: Tokens, axe: AxeLike | undefined, on: (c: string) => boolean): RawIssue[] {
  if (!isOk(s)) return [];
  return [
    ...(on("layout") ? layoutChecks(s, tokens) : []),
    ...(on("buttons") ? buttonChecks(s, tokens) : []),
    ...(on("typography") ? typographyChecks(s, tokens) : []),
    ...(on("content") ? contentChecks(s, tokens) : []),
    ...(on("a11y") && axe ? a11yIssues(s, axe) : []),
  ];
}

export async function runAudit(opts: AuditOptions): Promise<AuditResult> {
  const { tokens } = opts;
  const policy = opts.policy ?? {};
  const log = opts.log ?? console.log;
  const on = (c: string) => !opts.categories || opts.categories.includes(c);
  const startedAt = new Date().toISOString();
  const host = new URL(opts.startUrl).host.replace(/[^a-z0-9.-]+/gi, "_");
  const runDir = opts.runDir ?? join(opts.outDir, host, startedAt.replace(/[:.]/g, "-"));
  await mkdir(runDir, { recursive: true });

  const progress: AuditProgress = { phase: "discovering", pagesTotal: 0, pagesDone: 0, pagesFailed: 0, pagesSkipped: 0, findings: 0 };
  const report = async (patch: Partial<AuditProgress> = {}) => {
    Object.assign(progress, patch);
    await opts.onProgress?.({ ...progress });
  };
  const checkCancel = async () => {
    if (await opts.shouldCancel?.()) throw new AuditCancelledError();
  };

  await assertPublicUrl(opts.startUrl, policy);
  log(`Discovering pages for ${opts.startUrl}…`);
  await report();
  const found = await discover({
    startUrl: opts.startUrl,
    urls: opts.urls,
    maxPages: opts.maxPages ?? tokens.crawl.maxPages,
    userAgent: tokens.crawl.userAgent,
    policy,
  });
  log(`${found.pages.length} page(s) to scan, ${found.skipped.length} skipped, sitemap ${found.sitemapUrls ? "found" : "not found"}.`);
  await report({ phase: "scanning", pagesTotal: found.pages.length, pagesSkipped: found.skipped.length });

  const capturer = new Capturer(tokens, runDir, policy);
  const snapshots: PageSnapshot[] = [];
  const raw: RawIssue[] = [];
  const pages: PageResult[] = [];
  await capturer.start();
  try {
    for (const [n, url] of found.pages.entries()) {
      const slug = slugFor(url);
      let result: PageResult = { url, ok: true, status: 0 };
      for (const vw of tokens.viewports) {
        await checkCancel();
        log(`[${n + 1}/${found.pages.length}] ${url} @ ${vw}px`);
        await report({ currentUrl: url, currentViewport: vw });
        const cap = await capturer.capture(url, vw, slug, on("a11y") && tokens.a11yViewports.includes(vw));
        snapshots.push(cap.snapshot);
        await saveSnapshot(runDir, slug, cap.snapshot);
        if (cap.axe) await writeFile(join(runDir, "snapshots", slug, `${vw}.axe.json`), JSON.stringify(cap.axe));
        raw.push(...perSnapshotIssues(cap.snapshot, tokens, cap.axe, on));
        result = { url, ok: result.ok && isOk(cap.snapshot), status: cap.snapshot.meta.status, error: cap.error ?? result.error };
        await report({ findings: raw.length });
        // An error page looks the same at every width; don't hammer it.
        if (!isOk(cap.snapshot)) break;
      }
      pages.push(result);
      await report({ pagesDone: pages.length, pagesFailed: pages.filter((p) => !p.ok).length });
    }
  } finally {
    await capturer.close();
  }

  // Broken internal links: HEAD (GET fallback) on same-site links not already scanned. Rate-limited, robots respected.
  let linkResults: LinkResult[] = [];
  const sources = new Map<string, string[]>();
  if (on("content")) {
    await checkCancel();
    await report({ phase: "checking-links", currentUrl: undefined, currentViewport: undefined });
    const scanned = new Set(pages.map((p) => normalizeUrl(p.url)));
    for (const s of snapshots.filter((s) => isOk(s) && s.viewport === Math.max(...tokens.viewports))) {
      for (const l of s.meta.links ?? []) {
        const u = normalizeUrl(l);
        if (!u || scanned.has(u) || !isAllowed(found.robots, u)) continue;
        sources.set(u, [...new Set([...(sources.get(u) ?? []), s.url])]);
      }
    }
    const toCheck = [...sources.keys()].slice(0, tokens.crawl.maxLinkChecks ?? 100);
    linkResults = await checkLinks(toCheck, tokens, policy, checkCancel);
    log(`Checked ${linkResults.length} internal link(s).`);
  }

  await report({ phase: "analyzing" });
  const okSnaps = snapshots.filter(isOk);
  if (on("spacing")) {
    const baseline = buildBaseline(okSnaps);
    for (const s of okSnaps) raw.push(...spacingChecks(s, baseline, tokens));
  }
  // SEO and navigation are viewport independent: use each page's widest snapshot.
  const perPage = new Map<string, PageSnapshot>();
  for (const s of snapshots) {
    const prev = perPage.get(s.url);
    if (!prev || s.viewport > prev.viewport) perPage.set(s.url, s);
  }
  if (on("seo")) {
    for (const s of perPage.values()) raw.push(...seoChecks(s, tokens));
    raw.push(...siteSeoChecks([...perPage.values()], found.sitemapUrls));
  }
  if (on("navigation")) raw.push(...navigationChecks([...perPage.values()].filter(isOk)));
  if (on("consistency")) raw.push(...componentChecks(okSnaps));
  if (on("content")) raw.push(...brokenLinkIssues(linkResults, sources, (u) => perPage.get(u)));

  const issues = dedupeAndNumber(raw);
  await report({ phase: "annotating", findings: raw.length });
  log(`Annotating ${issues.length} issue(s)…`);
  await annotate(runDir, issues, tokens.crawl.browserChannel);

  await report({ phase: "writing" });
  const finishedAt = new Date().toISOString();
  const count = (key: "type" | "kind" | "severity") =>
    issues.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i[key]]: (acc[i[key]] ?? 0) + 1 }), {});
  const run = {
    startUrl: opts.startUrl,
    startedAt,
    finishedAt,
    pagesOk: pages.filter((p) => p.ok).length,
    pagesFailed: pages.filter((p) => !p.ok).length,
    pages,
    skipped: found.skipped,
    sitemapFound: !!found.sitemapUrls,
    linksChecked: linkResults.length,
    brokenLinks: linkResults.filter((l) => l.status === 0 || l.status >= 400),
    blockedRequests: capturer.blockedRequests,
    rawFindings: raw.length,
    issueCount: issues.length,
    byType: count("type"),
    byKind: count("kind"),
    bySeverity: count("severity"),
    settings: { viewports: tokens.viewports, a11yViewports: tokens.a11yViewports, categories: opts.categories ?? CATEGORIES, crawl: tokens.crawl },
  };
  await writeFile(join(runDir, "issues.json"), JSON.stringify(issues, null, 2));
  await writeFile(join(runDir, "run.json"), JSON.stringify(run, null, 2));
  await writeFile(join(runDir, "report.html"), renderReport(issues, { startUrl: opts.startUrl, startedAt, finishedAt, pages, skipped: found.skipped }));
  await report({ phase: "done", findings: raw.length });
  log(`Done: ${issues.length} issue(s) from ${raw.length} raw finding(s). Report: ${join(runDir, "report.html")}`);

  return { runDir, issues, summary: { pages, skipped: found.skipped, linksChecked: linkResults.length } };
}

async function checkLinks(urls: string[], tokens: Tokens, policy: SsrfPolicy, checkCancel: () => Promise<void>): Promise<LinkResult[]> {
  const results: LinkResult[] = [];
  const headers = { "user-agent": tokens.crawl.userAgent };
  const delay = Math.max(0, Math.round(tokens.crawl.delayMs / 2));
  for (const url of urls) {
    await checkCancel();
    try {
      let res = await guardedFetch(url, { method: "HEAD", headers, timeoutMs: 10_000 }, policy);
      if (res.status === 405 || res.status === 501) {
        res = await guardedFetch(url, { method: "GET", headers, timeoutMs: 10_000 }, policy);
        await res.body?.cancel();
      }
      results.push({ url, status: res.status });
    } catch (e) {
      results.push({ url, status: 0, error: (e as Error).message.split("\n")[0] });
    }
    if (delay) await sleep(delay);
  }
  return results;
}
