import type ExcelJS from "exceljs";
import type { ReportData } from "./data";
import { styleTable, type Col } from "./xlsx";
import { richResultsTestUrl } from "../../src/schema/validate";
import type { FieldKey } from "../google/types";

/** One worksheet: header row, data rows, or a single "No data: …" row explaining why it is empty. */
function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, unknown>[], empty: string) {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map(({ header, key, width }) => ({ header, key, width }));
  if (rows.length) rows.forEach((r) => ws.addRow(r));
  else ws.addRow({ [cols[0].key]: `No data: ${empty}` });
  styleTable(ws, cols, Math.max(rows.length, 1));
}

const FIELD_KEYS: FieldKey[] = ["lcp", "inp", "cls", "fcp", "ttfb"];

export function addGoogleSheets(wb: ExcelJS.Workbook, d: ReportData) {
  const g = d.google;
  const ok = g.psi.filter((p) => p.result);
  const sdItems = g.structured.flatMap((s) => s.items);
  const perf = g.gsc.performance;

  sheet(wb, "Google SEO Overview", [{ header: "Item", key: "k", width: 40 }, { header: "Value", key: "v", width: 90 }], [
    { k: "How to read this data", v: "Verified measurement = measured by WebAudit Pro or real-user Chrome data. Automated recommendation = Lighthouse/validator suggestion. Google-indexed information = Search Console (as of Google's last crawl). Needs review = uncertain." },
    { k: "PageSpeed Insights (Lighthouse lab)", v: ok.length ? `${ok.length} result(s), analysed ${ok.map((p) => p.result!.analysisTimestamp).sort()[0]} to ${ok.map((p) => p.result!.analysisTimestamp).sort().at(-1)}. Lab scores vary between runs.` : g.psiNote ?? "No successful results." },
    { k: "PageSpeed requests that failed", v: g.psi.filter((p) => !p.result).map((p) => `${p.url} (${p.strategy}): ${p.error}`).join("; ") || "None" },
    { k: "Real-user data (Chrome UX Report)", v: ok.some((p) => p.crux ?? p.result!.field) ? "Included where Google has enough traffic data (75th percentile, 28 days)." : "Not available for the analysed URLs." },
    { k: "Structured data (internal validator)", v: g.structuredNote ?? `${g.structured.length} page(s), ${sdItems.length} item(s), ${sdItems.flatMap((i) => i.issues).filter((i) => i.severity === "error").length} error(s). Rules ${g.structured[0]?.rulesVersion}. Not an official Rich Results Test result.` },
    { k: "Search Console property", v: g.gsc.property ?? "Not connected" },
    { k: "Search Console performance", v: perf ? `${perf.data.range.startDate} to ${perf.data.range.endDate} (fetched ${perf.fetchedAt}${perf.linkedToRun ? ", with this audit" : ", latest available"}): ${perf.data.totals.clicks} clicks, ${perf.data.totals.impressions} impressions` : g.gsc.note ?? "Not fetched." },
    { k: "URL inspections (Google-indexed)", v: g.gsc.inspections.length ? `${g.gsc.inspections.length} URL(s); ${g.gsc.inspections.filter((i) => i.data.verdict === "PASS").length} with verdict PASS` : g.gsc.note ?? "None run." },
    { k: "Sitemaps", v: g.gsc.sitemaps ? `${g.gsc.sitemaps.sitemaps.length} sitemap(s) (fetched ${g.gsc.sitemaps.fetchedAt})` : g.gsc.note ?? "Not fetched." },
  ], "");

  const psiCols: Col[] = [
    { header: "URL", key: "url", width: 45, link: true }, { header: "Analysed (UTC)", key: "at", width: 24 }, { header: "Lighthouse", key: "lh", width: 10 },
    { header: "Performance", key: "perf", width: 12 }, { header: "Accessibility", key: "a11y", width: 12 }, { header: "Best Practices", key: "bp", width: 13 }, { header: "SEO", key: "seo", width: 8 },
    { header: "LCP (ms, lab)", key: "lcp", width: 12 }, { header: "FCP (ms, lab)", key: "fcp", width: 12 }, { header: "CLS (lab)", key: "cls", width: 10 },
    { header: "TBT (ms, lab)", key: "tbt", width: 12 }, { header: "Speed Index (ms, lab)", key: "si", width: 14 },
    { header: "Field LCP p75 (ms)", key: "flcp", width: 14 }, { header: "Field INP p75 (ms)", key: "finp", width: 14 }, { header: "Field CLS p75", key: "fcls", width: 12 },
    { header: "Field data source", key: "fsrc", width: 24 }, { header: "Status", key: "status", width: 30 }, { header: "PageSpeed report", key: "link", width: 40, link: true },
  ];
  for (const strategy of ["mobile", "desktop"] as const) {
    sheet(wb, strategy === "mobile" ? "PageSpeed Mobile" : "PageSpeed Desktop", psiCols, g.psi.filter((p) => p.strategy === strategy).map((p) => {
      const r = p.result;
      const f = p.crux ?? r?.field ?? null;
      return {
        url: p.url, at: r?.analysisTimestamp ?? p.fetchedAt, lh: r?.lighthouseVersion ?? "",
        perf: r?.scores.performance ?? "", a11y: r?.scores.accessibility ?? "", bp: r?.scores.bestPractices ?? "", seo: r?.scores.seo ?? "",
        lcp: r?.lab.lcp?.value ?? "", fcp: r?.lab.fcp?.value ?? "", cls: r?.lab.cls?.value ?? "", tbt: r?.lab.tbt?.value ?? "", si: r?.lab.si?.value ?? "",
        flcp: f?.metrics.lcp?.p75 ?? "", finp: f?.metrics.inp?.p75 ?? "", fcls: f?.metrics.cls?.p75 ?? "",
        fsrc: f ? `${f.source === "crux-api" ? "CrUX API" : "PSI (CrUX)"}, ${f.scope}` : "Not available",
        status: r ? "OK" : `Unavailable: ${p.error}`, link: p.reportUrl,
      };
    }), `PageSpeed Insights ${strategy} was not run for this audit.`);
  }

  sheet(wb, "Performance Opportunities", [
    { header: "URL", key: "url", width: 40, link: true }, { header: "Device", key: "device", width: 9 }, { header: "Lighthouse audit ID", key: "id", width: 28 },
    { header: "Opportunity", key: "title", width: 36 }, { header: "Estimated savings", key: "savings", width: 24 }, { header: "Savings (ms)", key: "ms", width: 12 },
    { header: "Savings (bytes)", key: "bytes", width: 14 }, { header: "Affects", key: "affects", width: 14 }, { header: "Top resources", key: "items", width: 60 },
    { header: "Classification", key: "kind", width: 22 }, { header: "Analysed (UTC)", key: "at", width: 24 },
  ], ok.flatMap((p) => p.result!.opportunities.map((o) => ({
    url: p.url, device: p.strategy, id: o.id, title: o.title, savings: o.displayValue ?? "", ms: o.savingsMs ?? "", bytes: o.savingsBytes ?? "",
    affects: Object.keys(o.metricSavings ?? {}).join(", "), items: o.items.map((i) => i.url).filter(Boolean).join("\n"),
    kind: "Automated recommendation", at: p.result!.analysisTimestamp,
  }))), g.psiNote ?? "Lighthouse reported no opportunities.");

  sheet(wb, "Core Web Vitals", [
    { header: "URL", key: "url", width: 40, link: true }, { header: "Device", key: "device", width: 9 }, { header: "Metric", key: "metric", width: 10 },
    { header: "p75", key: "p75", width: 10 }, { header: "Unit", key: "unit", width: 10 }, { header: "Category", key: "cat", width: 18 },
    { header: "Source", key: "src", width: 26 }, { header: "Scope", key: "scope", width: 10 }, { header: "Period", key: "period", width: 26 },
  ], ok.flatMap((p) => {
    const f = p.crux ?? p.result!.field;
    if (!f) return [];
    return FIELD_KEYS.filter((k) => f.metrics[k]).map((k) => ({
      url: p.url, device: p.strategy, metric: k.toUpperCase(), p75: f.metrics[k]!.p75, unit: f.metrics[k]!.unit, cat: f.metrics[k]!.category,
      src: f.source === "crux-api" ? "Chrome UX Report API" : "PageSpeed Insights (CrUX)", scope: f.scope, period: f.period ?? "previous 28 days",
    }));
  }), ok.length ? "Google has no real-user (CrUX) data for the analysed URLs." : g.psiNote ?? "");

  sheet(wb, "Structured Data Findings", [
    { header: "URL", key: "url", width: 40, link: true }, { header: "Format", key: "format", width: 10 }, { header: "Schema type", key: "type", width: 20 },
    { header: "Google feature", key: "feature", width: 18 }, { header: "Schema validity", key: "status", width: 14 }, { header: "Google candidate check", key: "elig", width: 22 },
    { header: "Property", key: "prop", width: 26 }, { header: "Severity", key: "sev", width: 10 }, { header: "Message", key: "msg", width: 40 },
    { header: "Current", key: "cur", width: 30 }, { header: "Expected", key: "exp", width: 30 }, { header: "Documentation", key: "doc", width: 40, link: true },
    { header: "Rich Results Test", key: "rrt", width: 40, link: true },
  ], g.structured.flatMap((s) => s.items.flatMap((it) => (it.issues.length ? it.issues : [null]).map((i) => ({
    url: s.url, format: it.format, type: it.types.join(", "), feature: it.googleFeature ?? "None", status: it.status, elig: it.eligibility,
    prop: i?.property ?? "", sev: i?.severity ?? "", msg: i?.message ?? "No issues found", cur: i?.current ?? "", exp: i?.expected ?? "", doc: i?.docUrl ?? "", rrt: richResultsTestUrl(s.url),
  })))), g.structuredNote ?? "");

  const gscRows = perf ? [
    { section: "Totals", key: `${perf.data.range.startDate} to ${perf.data.range.endDate}`, ...perf.data.totals },
    { section: "Previous period", key: `${perf.data.previous.range.startDate} to ${perf.data.previous.range.endDate}`, ...perf.data.previous.totals },
    ...(["pages", "queries", "devices", "appearance"] as const).flatMap((sec) => (perf.data[sec] ?? []).map((r: { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }) => ({ section: sec, key: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))),
  ].map((r) => ({ ...r, ctr: typeof r.ctr === "number" ? Math.round(r.ctr * 10000) / 100 : "", position: typeof r.position === "number" ? Math.round(r.position * 10) / 10 : "", fetched: perf.fetchedAt })) : [];
  sheet(wb, "Search Console Performance", [
    { header: "Section", key: "section", width: 16 }, { header: "Page / query / device / range", key: "key", width: 50 }, { header: "Clicks", key: "clicks", width: 10 },
    { header: "Impressions", key: "impressions", width: 12 }, { header: "CTR (%)", key: "ctr", width: 10 }, { header: "Avg. position", key: "position", width: 12 }, { header: "Fetched (UTC)", key: "fetched", width: 24 },
  ], gscRows, g.gsc.note ?? "Search Console performance data was not fetched.");

  sheet(wb, "URL Inspection", [
    { header: "URL", key: "url", width: 40, link: true }, { header: "Verdict", key: "verdict", width: 10 }, { header: "Coverage", key: "coverage", width: 30 },
    { header: "Last Google crawl", key: "crawl", width: 22 }, { header: "Page fetch", key: "fetch", width: 14 }, { header: "Robots.txt", key: "robots", width: 12 },
    { header: "Indexing", key: "indexing", width: 18 }, { header: "Google canonical", key: "gc", width: 36 }, { header: "Declared canonical", key: "uc", width: 36 },
    { header: "Rich results (Google)", key: "rich", width: 30 }, { header: "Inspected (UTC)", key: "at", width: 24 }, { header: "Search Console", key: "link", width: 30, link: true },
  ], g.gsc.inspections.map((i) => ({
    url: i.url, verdict: i.data.verdict ?? "Not available", coverage: i.data.coverageState ?? "Not available", crawl: i.data.lastCrawlTime ?? "Not available",
    fetch: i.data.pageFetchState ?? "", robots: i.data.robotsTxtState ?? "", indexing: i.data.indexingState ?? "", gc: i.data.googleCanonical ?? "", uc: i.data.userCanonical ?? "",
    rich: i.data.richResults ? `${i.data.richResults.verdict}: ${i.data.richResults.items.map((x) => x.type).join(", ")}` : "Not available", at: i.fetchedAt, link: i.data.link ?? "",
  })), g.gsc.note ?? "No URLs were inspected.");

  sheet(wb, "Sitemap Status", [
    { header: "Sitemap", key: "path", width: 50, link: true }, { header: "Pending", key: "pending", width: 10 }, { header: "Last submitted", key: "sub", width: 24 },
    { header: "Last downloaded", key: "down", width: 24 }, { header: "Errors", key: "errors", width: 8 }, { header: "Warnings", key: "warnings", width: 9 },
    { header: "Submitted URLs", key: "contents", width: 30 }, { header: "Fetched (UTC)", key: "at", width: 24 },
  ], (g.gsc.sitemaps?.sitemaps ?? []).map((s) => ({
    path: s.path, pending: s.isPending ? "Yes" : "No", sub: s.lastSubmitted ?? "", down: s.lastDownloaded ?? "", errors: s.errors ?? "", warnings: s.warnings ?? "",
    contents: (s.contents ?? []).map((c) => `${c.submitted ?? "?"} ${c.type}`).join(", "), at: g.gsc.sitemaps!.fetchedAt,
  })), g.gsc.note ?? (g.gsc.sitemaps ? "Search Console reports no sitemaps." : "Sitemap status was not fetched."));
}
