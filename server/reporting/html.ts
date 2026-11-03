import type { ReportData, ReportIssue } from "./data";
import { label, statusText } from "./data";
import { googleSection } from "./html-google";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "");
const MAX_FEATURED = 25;
const MAX_IMAGES = 20;

/**
 * Findings shown in the client-facing body. Internally reviewed findings when there are any;
 * otherwise only high-confidence confirmed/recommendation findings, clearly labelled as not yet reviewed.
 * Everything else goes to the technical appendix, so the client is not overwhelmed.
 */
export function featured(d: ReportData): { items: ReportIssue[]; reviewed: boolean } {
  const reviewed = d.issues.filter((i) => i.verification_status === "confirmed" || i.review_status === "approved");
  if (reviewed.length) return { items: reviewed.slice(0, MAX_FEATURED), reviewed: true };
  return { items: d.issues.filter((i) => i.kind !== "needs-review" && i.confidence >= 0.7).slice(0, MAX_FEATURED), reviewed: false };
}

export function buildReportHtml(d: ReportData, images: Map<string, string>): string {
  const { items, reviewed } = featured(d);
  const featuredIds = new Set(items.map((i) => i.id));
  const appendix = d.issues.filter((i) => !featuredIds.has(i.id));
  const ok = d.pages.filter((p) => p.ok).length;
  const settings = d.run.settings as { viewports?: number[]; categories?: string[] };
  const bySev = (s: string) => d.issues.filter((i) => i.severity === s);
  const byKind = (k: string) => d.issues.filter((i) => i.kind === k).length;
  const decided = d.issues.filter((i) => i.client_decision);
  const standards = Object.entries(d.project.standards).filter(([, v]) => v);
  let imageCount = 0;

  const cmp = (i: ReportIssue) => `
    <table class="cmp"><tr><th>Current (measured)</th><th>Proposed</th></tr>
    <tr><td>${esc(i.current_value ?? "Not measured")}</td><td>${i.proposed_value ? esc(i.proposed_value) : "<em>Human review required. No reliable measured correction is available.</em>"}</td></tr></table>`;

  const card = (i: ReportIssue) => {
    const img = i.evidence.annotated && imageCount < MAX_IMAGES ? images.get(i.evidence.annotated) : undefined;
    if (img) imageCount++;
    return `
    <article class="finding">
      <header><span class="code">${esc(i.code)}</span><span class="sev sev-${esc(i.severity)}">${esc(label(i.severity))}</span>
        <span class="kind">${esc(label(i.kind))}</span>${reviewed ? "" : '<span class="kind">Not yet reviewed</span>'}</header>
      <h3>${esc(i.title)}</h3>
      <p class="meta">${esc(i.url)} · ${i.viewports.map((v) => `${v}px`).join(", ")}${i.pages.length > 1 ? ` · on ${i.pages.length} pages` : ""}</p>
      ${img ? `<figure><img src="${img}" alt="Annotated screenshot for ${esc(i.code)}"><figcaption>Highlighted element at ${i.viewports[0]}px, captured ${esc(date(i.captured_at))}</figcaption></figure>` : ""}
      ${cmp(i)}
      <p><strong>Recommended action:</strong> ${esc(i.recommendation)}</p>
      ${i.shared_template ? '<p class="warn">Shared template or component: one change here affects every listed page.</p>' : ""}
    </article>`;
  };

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.project.name)}: website audit report</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  :root { --navy:#0f1f3d; --ink:#1d2939; --muted:#667085; --line:#e4e7ec; --accent:#2563c9; --high:#b42318; --high-bg:#fdecea; --med:#b54708; --med-bg:#fef4e6; --low:#475467; --low-bg:#eef1f5; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 "Segoe UI", Arial, sans-serif; color: var(--ink); margin: 0; background: #fff; }
  main { max-width: 900px; margin: 0 auto; padding: 0 16px; }
  h1, h2, h3 { color: var(--navy); line-height: 1.25; }
  h2 { font-size: 16pt; border-bottom: 2px solid var(--navy); padding-bottom: 4px; margin-top: 28px; break-after: avoid; }
  h3 { font-size: 12pt; margin: 4px 0; }
  .cover { min-height: 250mm; display: flex; flex-direction: column; justify-content: center; break-after: page; }
  .cover .brand { font-size: 10pt; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
  .cover h1 { font-size: 30pt; margin: 8px 0; }
  .cover .site { font-size: 14pt; color: var(--muted); }
  .cover dl { margin-top: 32px; display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; }
  .cover dt { color: var(--muted); }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
  .stat { border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
  .stat b { display: block; font-size: 18pt; color: var(--navy); font-variant-numeric: tabular-nums; }
  .stat span { font-size: 8.5pt; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th, td { text-align: left; vertical-align: top; padding: 5px 6px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
  th { background: var(--navy); color: #fff; font-weight: 600; }
  .finding { border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin: 12px 0; break-inside: avoid; }
  .finding header { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .code { font: 600 9pt Consolas, monospace; color: var(--muted); }
  .sev, .kind { font-size: 8pt; font-weight: 700; border-radius: 10px; padding: 1px 8px; }
  .sev-high { background: var(--high-bg); color: var(--high); } .sev-medium { background: var(--med-bg); color: var(--med); } .sev-low { background: var(--low-bg); color: var(--low); }
  .kind { border: 1px solid var(--line); color: var(--muted); }
  .meta { color: var(--muted); font-size: 9pt; margin: 2px 0 8px; overflow-wrap: anywhere; }
  figure { margin: 8px 0; } figure img { max-width: 100%; max-height: 110mm; border: 1px solid var(--line); display: block; }
  figcaption { font-size: 8pt; color: var(--muted); }
  .cmp th { background: #f2f4f7; color: var(--navy); } .cmp td { width: 50%; }
  .warn { color: var(--med); font-size: 9pt; }
  .note { color: var(--muted); font-size: 9pt; }
  .appendix { break-before: page; }
  ol.steps li { margin-bottom: 4px; }
</style></head><body><main>

<section class="cover">
  <div class="brand">${esc(d.brand)}</div>
  <h1>Website UX/UI Audit</h1>
  <div class="site">${esc(d.project.name)} · ${esc(d.project.domain)}</div>
  <dl>
    <dt>Scan date</dt><dd>${esc(date(d.run.created_at))}</dd>
    <dt>Pages scanned</dt><dd>${ok} of ${d.pages.length}</dd>
    <dt>Viewports</dt><dd>${esc((settings.viewports ?? []).map((v) => `${v}px`).join(", "))}</dd>
    <dt>Report generated</dt><dd>${esc(date(d.generatedAt))}</dd>
  </dl>
</section>

<h2>1. Executive summary</h2>
<div class="stats">
  <div class="stat"><b>${d.issues.length}</b><span>Findings in scope</span></div>
  <div class="stat"><b>${byKind("confirmed")}</b><span>Confirmed</span></div>
  <div class="stat"><b>${byKind("recommendation")}</b><span>Recommendations</span></div>
  <div class="stat"><b>${bySev("high").length}</b><span>High severity</span></div>
</div>
<p>We scanned ${ok} public page${ok === 1 ? "" : "s"} of ${esc(d.project.domain)} at ${(settings.viewports ?? []).length} screen widths and measured layout, spacing, typography, buttons, accessibility, content and SEO basics.
${reviewed
    ? `This report highlights ${items.length} finding${items.length === 1 ? "" : "s"} that our team has reviewed.`
    : `None of the findings have been reviewed by our team yet; the ${items.length} highlighted below are high-confidence automated results and are marked "Not yet reviewed".`}
${appendix.length ? ` A further ${appendix.length} finding${appendix.length === 1 ? " is" : "s are"} listed in the technical appendix.` : ""}</p>
<p class="note">Internal quality indicator: ${d.score.score}/100. ${esc(d.score.explanation)}</p>

<h2>2. Audit scope</h2>
<p>Website: ${esc(d.project.base_url)}. Public pages only, discovered from ${(d.run.settings as { urls?: string[] }).urls?.length ? "a supplied URL list" : "robots.txt and the XML sitemap"}.
Categories: ${esc((settings.categories ?? ["all"]).join(", "))}. The audit is read-only: pages were loaded with GET requests, no forms were submitted and nothing on the website was changed.</p>
${standards.length ? `<p>Approved design standards used: ${standards.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join("; ")}.</p>` : "<p>No approved design tokens were supplied; spacing is compared against the site's own most common values.</p>"}

<h2>3. Scanned pages and viewports</h2>
<table><tr><th>Page</th><th>HTTP</th><th>Result</th><th>Findings</th></tr>
${d.pages.map((p) => `<tr><td>${esc(p.url)}</td><td>${p.status || "–"}</td><td>${p.ok ? "Scanned" : esc(p.error ?? "Failed")}</td><td>${p.findings}</td></tr>`).join("")}
</table>

<h2>4. Findings by severity</h2>
<table><tr><th>Severity</th><th>Total</th><th>Confirmed</th><th>Recommendation</th><th>Needs review</th></tr>
${["high", "medium", "low"].map((s) => `<tr><td>${label(s)}</td><td>${bySev(s).length}</td><td>${bySev(s).filter((i) => i.kind === "confirmed").length}</td><td>${bySev(s).filter((i) => i.kind === "recommendation").length}</td><td>${bySev(s).filter((i) => i.kind === "needs-review").length}</td></tr>`).join("")}
</table>

<h2>5. Prioritized recommendations</h2>
${items.length ? `<table><tr><th>#</th><th>Finding</th><th>Severity</th><th>Action</th></tr>
${items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.code)}: ${esc(i.title)}</td><td>${label(i.severity)}</td><td>${esc(i.recommendation)}</td></tr>`).join("")}</table>` : "<p>No findings met the reporting threshold.</p>"}

<h2>6. Screenshot evidence</h2>
<p class="note">Each highlighted finding includes the screenshot captured during the scan, with the affected element outlined.</p>
${items.map(card).join("")}

<h2>7. Current vs Proposed</h2>
<table><tr><th>Finding</th><th>Current (measured)</th><th>Proposed</th></tr>
${items.map((i) => `<tr><td>${esc(i.code)}: ${esc(i.title)}</td><td>${esc(i.current_value ?? "Not measured")}</td><td>${i.proposed_value ? esc(i.proposed_value) : "Human review required"}</td></tr>`).join("")}
</table>

<h2>8. Recommended developer actions</h2>
<table><tr><th>Finding</th><th>Element</th><th>Action</th><th>Owner</th><th>Status</th></tr>
${items.map((i) => `<tr><td>${esc(i.code)}</td><td>${esc(i.selector ?? "Page level")}${i.elementor_id ? `<br>Elementor ${esc(i.elementor_id)}` : ""}</td><td>${esc(i.recommendation)}</td><td>${esc(i.assignee_name ?? "Unassigned")}</td><td>${esc(label(i.implementation_status))}</td></tr>`).join("")}
</table>

<h2>9. Client decision summary</h2>
${decided.length ? `<table><tr><th>Finding</th><th>Decision</th><th>By</th><th>Comment</th></tr>
${decided.map((i) => `<tr><td>${esc(i.code)}: ${esc(i.title)}</td><td>${esc(label(i.client_decision))}</td><td>${esc(i.client_name ?? "")}</td><td>${esc(i.client_comment ?? "")}</td></tr>`).join("")}</table>`
    : "<p>No client decisions have been recorded for these findings yet. Decisions are collected through a private approval link.</p>"}

${googleSection(d)}

<h2>11. Methodology and limitations</h2>
<ul>
  <li>Pages are rendered in a real browser at each width; element sizes and computed styles are measured from the rendered page. Accessibility checks use axe-core (WCAG 2.1 A/AA rules).</li>
  <li><strong>Confirmed</strong> findings are measured facts (e.g. a tap target 20px tall). <strong>Recommendations</strong> are design improvements based on approved tokens or the site's own patterns. <strong>Needs review</strong> findings are uncertain and require human judgement.</li>
  <li>Repeated issues from shared templates are grouped into one finding listing every affected page.</li>
  <li>Not covered: logged-in areas, form submissions, interactive states (menus open, sliders advanced), third-party content changes after the scan, and full WCAG conformance. Automated checks cannot confirm legal compliance.</li>
  <li>Proposed values are suggestions derived from measurements; nothing is applied to the website automatically.</li>
</ul>

<h2>12. Next steps</h2>
<ol class="steps">
  <li>Review the highlighted findings and record your decisions through the approval link.</li>
  <li>Our developers implement the approved changes in a separate, authorized workflow.</li>
  <li>We run a fresh read-only audit and report what is resolved, still present or new.</li>
</ol>

${appendix.length ? `<section class="appendix"><h2>13. Technical appendix</h2>
<p class="note">All other findings in scope, including recommendations and findings that still need human review. Status shows our internal review state.</p>
<table><tr><th>ID</th><th>Finding</th><th>Severity</th><th>Classification</th><th>Page</th><th>Current</th><th>Status</th></tr>
${appendix.map((i) => `<tr><td>${esc(i.code)}</td><td>${esc(i.title)}</td><td>${label(i.severity)}</td><td>${label(i.kind)}</td><td>${esc(i.url)}${i.pages.length > 1 ? ` (+${i.pages.length - 1})` : ""}</td><td>${esc(i.current_value ?? "")}</td><td>${esc(statusText(i))}</td></tr>`).join("")}
</table></section>` : "<h2>13. Technical appendix</h2><p>No additional findings.</p>"}

</main></body></html>`;
}
