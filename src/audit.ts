import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Issue, PageSnapshot, RawIssue, Tokens } from "./types.js";
import { discover } from "./discover/discover.js";
import { Capturer, saveSnapshot } from "./capture/capture.js";
import { buildBaseline } from "./baseline/spacing.js";
import { layoutChecks } from "./checks/layout.js";
import { buttonChecks } from "./checks/buttons.js";
import { typographyChecks } from "./checks/typography.js";
import { spacingChecks } from "./checks/spacing.js";
import { seoChecks, siteSeoChecks } from "./checks/seo.js";
import { a11yIssues, type AxeLike } from "./checks/a11y.js";
import { dedupeAndNumber } from "./report/dedupe.js";
import { annotate } from "./report/annotate.js";
import { renderReport } from "./report/html.js";

export interface AuditOptions {
  startUrl: string;
  urls?: string[];
  maxPages?: number;
  outDir: string;
  tokens: Tokens;
  log?: (msg: string) => void;
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
  summary: { pages: PageResult[]; skipped: { url: string; reason: string }[] };
}

/** Short, readable, unique folder name per URL: "home", "loans-fha-3f2a1c". */
export function slugFor(url: string): string {
  const u = new URL(url);
  const base = (u.pathname + u.search).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60);
  if (!base) return "home";
  return `${base}-${createHash("sha1").update(url).digest("hex").slice(0, 6)}`;
}

const isOk = (s: PageSnapshot) => s.meta.status > 0 && s.meta.status < 400;

export async function runAudit(opts: AuditOptions): Promise<AuditResult> {
  const { tokens } = opts;
  const log = opts.log ?? console.log;
  const startedAt = new Date().toISOString();
  const host = new URL(opts.startUrl).host.replace(/[^a-z0-9.-]+/gi, "_");
  const runDir = join(opts.outDir, host, startedAt.replace(/[:.]/g, "-"));
  await mkdir(runDir, { recursive: true });

  log(`Discovering pages for ${opts.startUrl}…`);
  const found = await discover({
    startUrl: opts.startUrl,
    urls: opts.urls,
    maxPages: opts.maxPages ?? tokens.crawl.maxPages,
    userAgent: tokens.crawl.userAgent,
  });
  log(`${found.pages.length} page(s) to scan, ${found.skipped.length} skipped, sitemap ${found.sitemapUrls ? "found" : "not found"}.`);

  const capturer = new Capturer(tokens, runDir);
  const snapshots: PageSnapshot[] = [];
  const axeBySnapshot = new Map<PageSnapshot, AxeLike>();
  const pages: PageResult[] = [];
  await capturer.start();
  try {
    for (const [n, url] of found.pages.entries()) {
      const slug = slugFor(url);
      let result: PageResult = { url, ok: true, status: 0 };
      for (const vw of tokens.viewports) {
        log(`[${n + 1}/${found.pages.length}] ${url} @ ${vw}px`);
        const cap = await capturer.capture(url, vw, slug, tokens.a11yViewports.includes(vw));
        snapshots.push(cap.snapshot);
        if (cap.axe) axeBySnapshot.set(cap.snapshot, cap.axe);
        await saveSnapshot(runDir, slug, cap.snapshot);
        result = { url, ok: result.ok && isOk(cap.snapshot), status: cap.snapshot.meta.status, error: cap.error ?? result.error };
        // An error page looks the same at every width; don't hammer it.
        if (!isOk(cap.snapshot)) break;
      }
      pages.push(result);
    }
  } finally {
    await capturer.close();
  }

  log("Running checks…");
  const okSnaps = snapshots.filter(isOk);
  const baseline = buildBaseline(okSnaps);
  const raw: RawIssue[] = [];
  for (const s of okSnaps) {
    raw.push(...layoutChecks(s, tokens), ...buttonChecks(s, tokens), ...typographyChecks(s, tokens), ...spacingChecks(s, baseline, tokens));
    const axe = axeBySnapshot.get(s);
    if (axe) raw.push(...a11yIssues(s, axe));
  }
  // SEO is viewport independent: check each page once, on its widest snapshot.
  const perPage = new Map<string, PageSnapshot>();
  for (const s of snapshots) {
    const prev = perPage.get(s.url);
    if (!prev || s.viewport > prev.viewport) perPage.set(s.url, s);
  }
  for (const s of perPage.values()) raw.push(...seoChecks(s, tokens));
  raw.push(...siteSeoChecks([...perPage.values()], found.sitemapUrls));

  const issues = dedupeAndNumber(raw);
  log(`Annotating ${issues.length} issue(s)…`);
  await annotate(runDir, issues, tokens.crawl.browserChannel);

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
    issueCount: issues.length,
    byType: count("type"),
    byKind: count("kind"),
    bySeverity: count("severity"),
    settings: { viewports: tokens.viewports, a11yViewports: tokens.a11yViewports, crawl: tokens.crawl },
  };
  await writeFile(join(runDir, "issues.json"), JSON.stringify(issues, null, 2));
  await writeFile(join(runDir, "run.json"), JSON.stringify(run, null, 2));
  await writeFile(join(runDir, "report.html"), renderReport(issues, { startUrl: opts.startUrl, startedAt, finishedAt, pages, skipped: found.skipped }));
  log(`Done: ${issues.length} issue(s). Report: ${join(runDir, "report.html")}`);

  return { runDir, issues, summary: { pages, skipped: found.skipped } };
}
