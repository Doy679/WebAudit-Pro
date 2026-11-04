// "WebAudit Pro Website Health": one summary with a separate measure per category.
// Deliberately no overall score: the categories measure different things from different sources.
import { all, get } from "./db";
import type { User } from "./auth";
import { assertProjectAccess } from "./permissions";
import { inspections, latestGsc, projectGoogle, psiResults, type PsiRow } from "./google/service";
import { searchConsoleStatus } from "./google/gsc-status";

type Counts = { confirmed: number; recommendation: number; needsReview: number; high: number };

export interface HealthSection {
  key: "design" | "a11y" | "seo" | "performance" | "structured" | "visibility" | "indexing";
  title: string;
  state: "ok" | "not-run" | "not-connected";
  why?: string;
  findings?: Counts;
  metrics: { label: string; value: string | number | null; note?: string }[];
  source: string;
  href?: string;
}

const TYPES = {
  design: ["layout", "spacing", "typography", "buttons", "consistency"],
  a11y: ["a11y"],
  seo: ["seo", "content", "navigation"],
  performance: ["performance", "cwv"],
  structured: ["structured-data"],
  indexing: ["indexing", "search-console"],
};

function counts(runId: string, types: string[]): Counts {
  const r = get<Counts>(
    `SELECT SUM(kind = 'confirmed') AS confirmed, SUM(kind = 'recommendation') AS recommendation, SUM(kind = 'needs-review') AS needsReview, SUM(severity = 'high') AS high
     FROM issues WHERE run_id = ? AND verification_status != 'false_positive' AND type IN (${types.map(() => "?").join(",")})`, runId, ...types);
  return { confirmed: r?.confirmed ?? 0, recommendation: r?.recommendation ?? 0, needsReview: r?.needsReview ?? 0, high: r?.high ?? 0 };
}

export function websiteHealth(user: User, projectId: string, runId?: string) {
  assertProjectAccess(user, projectId);
  const run = runId
    ? get<{ id: string; start_url: string; settings_json: string; created_at: string }>("SELECT id, start_url, settings_json, created_at FROM audit_runs WHERE id = ? AND project_id = ?", runId, projectId)
    : get<{ id: string; start_url: string; settings_json: string; created_at: string }>("SELECT id, start_url, settings_json, created_at FROM audit_runs WHERE project_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1", projectId);
  const categories: string[] | undefined = run ? JSON.parse(run.settings_json).categories : undefined;
  const ran = (c: string) => !!run && (!categories?.length || categories.includes(c));
  const pg = projectGoogle(user, projectId);
  const sections: HealthSection[] = [];

  const engine = (key: "design" | "a11y" | "seo", title: string, cats: string[], extra: HealthSection["metrics"] = []): HealthSection =>
    run && cats.some(ran)
      ? { key, title, state: "ok", findings: counts(run.id, TYPES[key]), metrics: extra, source: "WebAudit Pro live crawl", href: `/issues?run=${run.id}&types=${TYPES[key].join(",")}` }
      : { key, title, state: "not-run", why: run ? "Category not included in the audit" : "No completed audit", metrics: [], source: "WebAudit Pro live crawl" };

  // Lighthouse results for the audit's start page (linked to the run when available, else the project's latest).
  const psiFor = (strategy: "mobile" | "desktop"): PsiRow | undefined => {
    if (!run) return undefined;
    const linked = psiResults(user, { projectId, runId: run.id, url: run.start_url, strategy, limit: 1 })[0];
    return linked ?? psiResults(user, { projectId, url: run.start_url, strategy, limit: 1 })[0];
  };
  const mobile = psiFor("mobile"), desktop = psiFor("desktop");
  const score = (r: PsiRow | undefined, k: "performance" | "accessibility" | "seo") => (r?.result ? r.result.scores[k] : null);

  sections.push(engine("design", "Design & Responsive", ["layout", "spacing", "typography", "buttons", "consistency"]));
  sections.push(engine("a11y", "Accessibility", ["a11y"], [{ label: "Lighthouse accessibility (mobile)", value: score(mobile, "accessibility"), note: "0–100, Google lab test" }]));
  sections.push(engine("seo", "Technical SEO", ["seo", "content", "navigation"], [{ label: "Lighthouse SEO (mobile)", value: score(mobile, "seo"), note: "0–100, Google lab test" }]));

  const field = mobile?.crux ?? mobile?.result?.field ?? null;
  sections.push(mobile?.result || desktop?.result ? {
    key: "performance", title: "Performance", state: "ok", source: "Google PageSpeed Insights",
    findings: run ? counts(run.id, TYPES.performance) : undefined,
    metrics: [
      { label: "Performance score (mobile)", value: score(mobile, "performance"), note: "Lighthouse lab, varies run to run" },
      { label: "Performance score (desktop)", value: score(desktop, "performance") },
      { label: "LCP (mobile, lab)", value: mobile?.result?.lab.lcp?.display ?? null },
      { label: "CLS (mobile, lab)", value: mobile?.result?.lab.cls?.display ?? null },
      { label: "Real-user Core Web Vitals", value: field ? Object.entries(field.metrics).map(([k, m]) => `${k.toUpperCase()} ${m!.category.replace("-", " ")}`).join(", ") : null, note: field ? "Chrome UX Report, p75, 28 days" : "Google has no field data" },
    ],
    href: `/google/pagespeed?project=${projectId}`,
  } : { key: "performance", title: "Performance", state: "not-run", why: "PageSpeed Insights not run for the start page", metrics: [], source: "Google PageSpeed Insights", href: `/google/pagespeed?project=${projectId}` });

  const sd = run ? get<{ pages: number; items: number; errors: number; warnings: number }>(
    "SELECT COUNT(*) AS pages, SUM(json_array_length(items_json)) AS items, SUM(errors) AS errors, SUM(warnings) AS warnings FROM structured_data WHERE run_id = ?", run.id) : undefined;
  sections.push(run && ran("structured-data") ? {
    key: "structured", title: "Structured Data", state: "ok", source: "Internal schema validator", findings: counts(run.id, TYPES.structured),
    metrics: [{ label: "Pages with structured data", value: sd?.pages ?? 0 }, { label: "Items", value: sd?.items ?? 0 }, { label: "Errors / warnings", value: `${sd?.errors ?? 0} / ${sd?.warnings ?? 0}` }],
    href: `/google/structured-data?project=${projectId}&run=${run.id}`,
  } : { key: "structured", title: "Structured Data", state: "not-run", why: run ? "Category not included in the audit" : "No completed audit", metrics: [], source: "Internal schema validator" });

  const connected = !!(pg.gsc_property && pg.connection_id);
  const gscLabel = searchConsoleStatus(user, projectId).label; // same wording as every other screen (BUG-02)
  const perf = connected ? latestGsc(user, projectId, "performance") : undefined;
  sections.push(!connected ? { key: "visibility", title: "Google Search Visibility", state: "not-connected", why: gscLabel, metrics: [], source: "Google Search Console", href: `/google/connections?project=${projectId}` }
    : perf?.status === "ok" ? {
      key: "visibility", title: "Google Search Visibility", state: "ok", source: `Google Search Console · ${perf.data.range.startDate} to ${perf.data.range.endDate}`,
      metrics: [
        { label: "Clicks", value: perf.data.totals.clicks, note: `previous period ${perf.data.previous.totals.clicks}` },
        { label: "Impressions", value: perf.data.totals.impressions, note: `previous period ${perf.data.previous.totals.impressions}` },
        { label: "Average position", value: perf.data.totals.position === null ? null : Number(perf.data.totals.position.toFixed(1)) },
      ],
      href: `/google/search-console?project=${projectId}`,
    } : { key: "visibility", title: "Google Search Visibility", state: "not-run", why: perf ? `Last request failed: ${perf.error}` : "No Search Console data fetched", metrics: [], source: "Google Search Console", href: `/google/search-console?project=${projectId}` });

  const insp = connected ? inspections(user, projectId).filter((i) => i.status === "ok") : [];
  const sitemaps = connected ? latestGsc(user, projectId, "sitemaps") : undefined;
  sections.push(!connected ? { key: "indexing", title: "Indexing & Crawl Health", state: "not-connected", why: gscLabel, metrics: [], source: "Google Search Console", href: `/google/connections?project=${projectId}` }
    : insp.length || sitemaps?.status === "ok" ? {
      key: "indexing", title: "Indexing & Crawl Health", state: "ok", source: "Google Search Console (Google-indexed data)",
      findings: run ? counts(run.id, TYPES.indexing) : undefined,
      metrics: [
        { label: "URLs inspected", value: insp.length },
        { label: "Indexed (verdict PASS)", value: insp.filter((i) => i.data.verdict === "PASS").length },
        { label: "Sitemap errors", value: sitemaps?.status === "ok" ? sitemaps.data.sitemaps.reduce((s: number, x: { errors?: number }) => s + (x.errors ?? 0), 0) : null },
      ],
      href: `/google/inspection?project=${projectId}`,
    } : { key: "indexing", title: "Indexing & Crawl Health", state: "not-run", why: "No URL inspection or sitemap data yet", metrics: [], source: "Google Search Console", href: `/google/inspection?project=${projectId}` });

  return { run: run ?? null, sections, coverage: sections.filter((s) => s.state === "ok").length, total: sections.length };
}

/** Pages of a run, used to pre-fill Google requests. */
export const okPages = (runId: string) => all<{ url: string }>("SELECT url FROM run_pages WHERE run_id = ? AND ok = 1 ORDER BY url", runId).map((r) => r.url);
