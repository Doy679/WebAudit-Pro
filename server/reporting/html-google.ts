import type { ReportData } from "./data";
import { fmtFieldValue } from "../google/psi";
import { richResultsTestUrl } from "../../src/schema/validate";
import type { FieldKey } from "../google/types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "");
const na = '<em class="note">Not available</em>';
const score = (n: number | null | undefined) => (n === null || n === undefined ? na : `<strong>${n}</strong>`);
const shortUrl = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? x.host : x.pathname; } catch { return u; } };

/** "10. Google SEO & Performance" section of the client report. */
export function googleSection(d: ReportData): string {
  const g = d.google;
  const ok = g.psi.filter((p) => p.result);
  const opportunities = ok.flatMap((p) => p.result!.opportunities.map((o) => ({ ...o, url: p.url, strategy: p.strategy })))
    .sort((a, b) => (b.savingsMs ?? Math.max(0, ...Object.values(b.metricSavings ?? {}))) - (a.savingsMs ?? Math.max(0, ...Object.values(a.metricSavings ?? {}))))
    .slice(0, 10);
  const sdErrors = g.structured.flatMap((s) => s.items.flatMap((it) => it.issues.filter((i) => i.severity === "error").map((i) => ({ ...i, url: s.url, type: it.types.join(", ") })))).slice(0, 15);
  const indexing = d.issues.filter((i) => i.provider === "gsc");
  const perf = g.gsc.performance;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return `
<h2>10. Google SEO &amp; Performance</h2>
<p class="note">Data basis: <strong>Lighthouse lab</strong> scores are a simulated Google test that varies between runs; <strong>real-user data</strong> comes from the Chrome UX Report (75th percentile of the last 28 days);
<strong>Google-indexed information</strong> comes from Search Console and reflects Google's last crawl, not the live page; <strong>structured data</strong> results are WebAudit Pro's internal checks against Google's documentation, not an official Rich Results Test.</p>

<h3>SEO summary</h3>
<ul>
  <li>PageSpeed Insights: ${ok.length ? `${ok.length} Lighthouse lab test(s), ${date(ok[0].result!.analysisTimestamp)}` : esc(g.psiNote ?? "No successful results.")}${g.psi.some((p) => !p.result) ? ` (${g.psi.filter((p) => !p.result).length} request(s) unavailable)` : ""}</li>
  <li>Structured data: ${g.structuredNote ? esc(g.structuredNote) : `${g.structured.length} page(s) with structured data, ${sdErrors.length ? `${g.structured.flatMap((s) => s.items).flatMap((i) => i.issues).filter((i) => i.severity === "error").length} error(s)` : "no errors"}`}</li>
  <li>Search Console: ${g.gsc.property ? `property ${esc(g.gsc.property)}` : "not connected"}${perf ? `; ${perf.data.totals.clicks.toLocaleString("en-US")} clicks and ${perf.data.totals.impressions.toLocaleString("en-US")} impressions, ${perf.data.range.startDate} to ${perf.data.range.endDate}` : ""}</li>
</ul>

<h3>PageSpeed scores (Lighthouse lab)</h3>
${ok.length ? `<table><tr><th>Page</th><th>Device</th><th>Performance</th><th>Accessibility</th><th>Best practices</th><th>SEO</th><th>LCP</th><th>CLS</th><th>TBT</th><th>Tested</th></tr>
${ok.map((p) => `<tr><td>${esc(shortUrl(p.url))}</td><td>${p.strategy}</td><td>${score(p.result!.scores.performance)}</td><td>${score(p.result!.scores.accessibility)}</td><td>${score(p.result!.scores.bestPractices)}</td><td>${score(p.result!.scores.seo)}</td><td>${esc(p.result!.lab.lcp?.display ?? "–")}</td><td>${esc(p.result!.lab.cls?.display ?? "–")}</td><td>${esc(p.result!.lab.tbt?.display ?? "–")}</td><td>${date(p.result!.analysisTimestamp)}</td></tr>`).join("")}</table>
<p class="note">Scores are 0–100 (90+ good, 50–89 needs improvement, under 50 poor). Lighthouse results vary between runs; small differences are normal.</p>` : `<p>${esc(g.psiNote ?? "No PageSpeed data.")}</p>`}

<h3>Core Web Vitals (real users)</h3>
${(() => {
    const rows = ok.flatMap((p) => {
      const f = p.crux ?? p.result!.field;
      return f ? [{ p, f }] : [];
    });
    if (!rows.length) return `<p>${ok.length ? "Google has no real-user data for the tested pages (not enough Chrome traffic)." : "Not available."}</p>`;
    const keys: FieldKey[] = ["lcp", "inp", "cls"];
    return `<table><tr><th>Page</th><th>Device</th>${keys.map((k) => `<th>${k.toUpperCase()} (p75)</th>`).join("")}<th>Scope</th></tr>
${rows.map(({ p, f }) => `<tr><td>${esc(shortUrl(p.url))}</td><td>${p.strategy}</td>${keys.map((k) => `<td>${f.metrics[k] ? `${esc(fmtFieldValue(f.metrics[k]!))} (${f.metrics[k]!.category.replace("-", " ")})` : na}</td>`).join("")}<td>${f.scope === "origin" ? "whole site" : "this page"}</td></tr>`).join("")}</table>`;
  })()}

<h3>Top performance opportunities</h3>
${opportunities.length ? `<table><tr><th>Opportunity</th><th>Page</th><th>Device</th><th>Estimated savings</th></tr>
${opportunities.map((o) => `<tr><td>${esc(o.title)}<br><span class="note">Lighthouse audit ${esc(o.id)}</span></td><td>${esc(shortUrl(o.url))}</td><td>${o.strategy}</td><td>${esc(o.displayValue ?? "")}</td></tr>`).join("")}</table>
<p class="note">Automated recommendations with Lighthouse's estimated savings; not confirmed malfunctions.</p>` : "<p>No opportunities reported.</p>"}

<h3>Structured data errors</h3>
${sdErrors.length ? `<table><tr><th>Page</th><th>Type</th><th>Property</th><th>Problem</th><th>Expected</th></tr>
${sdErrors.map((e) => `<tr><td>${esc(shortUrl(e.url))}</td><td>${esc(e.type)}</td><td>${esc(e.property)}</td><td>${esc(e.message)}</td><td>${esc(e.expected ?? "")}</td></tr>`).join("")}</table>
<p class="note">Confirm fixes with Google's Rich Results Test, e.g. ${esc(richResultsTestUrl(g.structured[0]?.url ?? d.project.base_url))}. Google does not guarantee rich results even for valid markup.</p>` : `<p>${esc(g.structuredNote ?? "No structured data errors found.")}</p>`}

<h3>Search visibility</h3>
${perf ? `<table><tr><th></th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Avg. position</th></tr>
<tr><td>${esc(perf.data.range.startDate)} to ${esc(perf.data.range.endDate)}</td><td>${perf.data.totals.clicks.toLocaleString("en-US")}</td><td>${perf.data.totals.impressions.toLocaleString("en-US")}</td><td>${pct(perf.data.totals.ctr)}</td><td>${perf.data.totals.position?.toFixed(1) ?? "–"}</td></tr>
<tr><td>Previous period</td><td>${perf.data.previous.totals.clicks.toLocaleString("en-US")}</td><td>${perf.data.previous.totals.impressions.toLocaleString("en-US")}</td><td>${pct(perf.data.previous.totals.ctr)}</td><td>${perf.data.previous.totals.position?.toFixed(1) ?? "–"}</td></tr></table>
<p class="note">Google Search Console, fetched ${date(perf.fetchedAt)}. Search traffic is context for the audit, not a technical defect.</p>` : `<p>Search Console: ${g.gsc.property ? "performance data not fetched" : "not connected"}.</p>`}

<h3>Indexing (Google-indexed information)</h3>
${g.gsc.inspections.length ? `<table><tr><th>Page</th><th>Google's status</th><th>Last Google crawl</th><th>Canonical chosen by Google</th></tr>
${g.gsc.inspections.map((i) => `<tr><td>${esc(shortUrl(i.url))}</td><td>${esc(i.data.coverageState ?? i.data.verdict ?? "Not available")}</td><td>${i.data.lastCrawlTime ? date(i.data.lastCrawlTime) : na}</td><td>${esc(i.data.googleCanonical ?? "Not available")}</td></tr>`).join("")}</table>
${indexing.length ? `<p>${indexing.length} indexing finding(s) are included in the findings above (source: Google Search Console).</p>` : ""}` : "<p>No URL inspections were run.</p>"}
`;
}
