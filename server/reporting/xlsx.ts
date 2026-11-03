import ExcelJS from "exceljs";
import type { ReportData, ReportIssue } from "./data";
import { label, statusText } from "./data";

const NAVY = "FF0F1F3D";
const SEV_FILL: Record<string, string> = { high: "FFFDECEA", medium: "FFFEF4E6", low: "FFEEF1F5" };

interface Col { header: string; key: string; width: number; link?: boolean }

const ISSUE_COLS: Col[] = [
  { header: "Issue ID", key: "code", width: 11 },
  { header: "Page URL", key: "url", width: 42, link: true },
  { header: "Category", key: "type", width: 14 },
  { header: "Classification", key: "kind", width: 16 },
  { header: "Severity", key: "severity", width: 10 },
  { header: "Confidence", key: "confidence", width: 11 },
  { header: "Viewport", key: "viewports", width: 16 },
  { header: "Element / Selector", key: "selector", width: 36 },
  { header: "Issue", key: "title", width: 34 },
  { header: "Current", key: "current", width: 30 },
  { header: "Proposed", key: "proposed", width: 34 },
  { header: "Recommended Fix", key: "recommendation", width: 48 },
  { header: "Evidence Reference", key: "evidence", width: 30, link: true },
  { header: "Affected Pages", key: "pageCount", width: 9 },
  { header: "Status", key: "status", width: 26 },
  { header: "Assignee", key: "assignee", width: 16 },
  { header: "Notes", key: "notes", width: 40 },
];

function issueRow(i: ReportIssue, d: ReportData) {
  return {
    code: i.code,
    url: i.url,
    type: i.type,
    kind: label(i.kind),
    severity: label(i.severity),
    confidence: Math.round(i.confidence * 100) / 100,
    viewports: i.viewports.map((v) => `${v}px`).join(", "),
    selector: [i.selector, i.elementor_id ? `Elementor ${i.elementor_id}` : ""].filter(Boolean).join(" | "),
    title: i.title,
    current: i.current_value ?? "",
    proposed: i.proposed_value ?? "Human review required: no reliable measured correction",
    recommendation: i.recommendation,
    evidence: `${d.appUrl}/issues/${i.id}`,
    pageCount: i.pages.length,
    status: statusText(i),
    assignee: i.assignee_name ?? "",
    notes: i.notes,
  };
}

function styleTable(ws: ExcelJS.Worksheet, cols: Col[], rowCount: number) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 24;
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(rowCount + 1, 1), column: cols.length } };
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    cols.forEach((c, idx) => {
      if (!c.link) return;
      const cell = row.getCell(idx + 1);
      const url = String(cell.value ?? "");
      if (/^https?:\/\//.test(url)) {
        cell.value = { text: url, hyperlink: url };
        cell.font = { color: { argb: "FF2563C9" }, underline: true };
      }
    });
  });
}

function addIssueSheet(wb: ExcelJS.Workbook, name: string, issues: ReportIssue[], d: ReportData) {
  const ws = wb.addWorksheet(name);
  ws.columns = ISSUE_COLS.map(({ header, key, width }) => ({ header, key, width }));
  for (const i of issues) {
    const row = ws.addRow(issueRow(i, d));
    const sevIdx = ISSUE_COLS.findIndex((c) => c.key === "severity") + 1;
    row.getCell(sevIdx).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SEV_FILL[i.severity] ?? SEV_FILL.low } };
  }
  styleTable(ws, ISSUE_COLS, issues.length);
}

function keyValueSheet(wb: ExcelJS.Workbook, name: string, rows: [string, string | number][]) {
  const ws = wb.addWorksheet(name);
  ws.columns = [{ header: "Item", key: "k", width: 34 }, { header: "Value", key: "v", width: 90 }];
  for (const [k, v] of rows) ws.addRow({ k, v });
  styleTable(ws, [{ header: "Item", key: "k", width: 34 }, { header: "Value", key: "v", width: 90 }], rows.length);
  ws.getColumn(1).font = { bold: true };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  return ws;
}

export async function buildXlsx(d: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = d.brand;
  wb.created = new Date(d.generatedAt);
  const count = (pred: (i: ReportIssue) => boolean) => d.issues.filter(pred).length;
  const ok = d.pages.filter((p) => p.ok).length;
  const settings = d.run.settings as { viewports?: number[]; categories?: string[]; maxPages?: number; delayMs?: number; urls?: string[] };

  keyValueSheet(wb, "Executive Overview", [
    ["Project name", d.project.name],
    ["Website", d.project.base_url],
    ["Scan date", d.run.created_at.slice(0, 10)],
    ["Pages scanned", ok],
    ["Pages attempted", d.pages.length],
    ["Scan coverage and limitations",
      `${ok} of ${d.pages.length} pages scanned successfully at ${(settings.viewports ?? []).join(", ")}px. Public pages only; ` +
      "logged-in areas, forms and interactive states were not tested. Automated findings require human review before client use."],
    ["Findings in this report", d.issues.length],
    ["Confirmed issues", count((i) => i.kind === "confirmed")],
    ["Recommendations", count((i) => i.kind === "recommendation")],
    ["Needs-review findings", count((i) => i.kind === "needs-review")],
    ["High severity", count((i) => i.severity === "high")],
    ["Medium severity", count((i) => i.severity === "medium")],
    ["Low severity", count((i) => i.severity === "low")],
    ["Internally verified or approved", count((i) => i.verification_status === "confirmed" || i.review_status === "approved")],
    ["Audit quality score (internal indicator)", `${d.score.score}/100. ${d.score.explanation}`],
  ]);

  addIssueSheet(wb, "All Issues", d.issues, d);
  addIssueSheet(wb, "Confirmed Issues", d.issues.filter((i) => i.kind === "confirmed"), d);
  addIssueSheet(wb, "Recommendations", d.issues.filter((i) => i.kind === "recommendation"), d);
  addIssueSheet(wb, "Needs Review", d.issues.filter((i) => i.kind === "needs-review"), d);

  const trackerCols: Col[] = [
    { header: "Issue ID", key: "code", width: 11 }, { header: "Priority", key: "priority", width: 10 }, { header: "Severity", key: "severity", width: 10 },
    { header: "Page URL", key: "url", width: 40, link: true }, { header: "Affected Pages", key: "pages", width: 9 }, { header: "Element / Selector", key: "selector", width: 34 },
    { header: "Shared Template", key: "shared", width: 10 }, { header: "Action", key: "action", width: 50 }, { header: "Proposed", key: "proposed", width: 30 },
    { header: "Assignee", key: "assignee", width: 16 }, { header: "Implementation Status", key: "impl", width: 16 }, { header: "Review Status", key: "review", width: 18 },
    { header: "Client Decision", key: "client", width: 18 }, { header: "Notes", key: "notes", width: 40 }, { header: "Evidence Reference", key: "evidence", width: 30, link: true },
  ];
  const tracker = wb.addWorksheet("Developer Action Tracker");
  tracker.columns = trackerCols.map(({ header, key, width }) => ({ header, key, width }));
  const actionable = d.issues.filter((i) => i.verification_status !== "false_positive" && i.review_status !== "rejected");
  for (const i of actionable) {
    tracker.addRow({
      code: i.code, priority: label(i.priority) || label(i.severity), severity: label(i.severity), url: i.url, pages: i.pages.length,
      selector: i.selector ?? "", shared: i.shared_template ? "Yes" : "No", action: i.recommendation, proposed: i.proposed_value ?? "Human review required",
      assignee: i.assignee_name ?? "", impl: label(i.implementation_status), review: label(i.review_status),
      client: i.client_decision ? `${label(i.client_decision)}${i.client_name ? ` (${i.client_name})` : ""}` : "", notes: i.notes,
      evidence: `${d.appUrl}/issues/${i.id}`,
    });
  }
  styleTable(tracker, trackerCols, actionable.length);

  const pageCols: Col[] = [
    { header: "Page URL", key: "url", width: 60, link: true }, { header: "HTTP Status", key: "status", width: 11 },
    { header: "Result", key: "result", width: 12 }, { header: "Error", key: "error", width: 40 }, { header: "Findings", key: "findings", width: 10 },
  ];
  const pagesWs = wb.addWorksheet("Pages Audited");
  pagesWs.columns = pageCols.map(({ header, key, width }) => ({ header, key, width }));
  for (const p of d.pages) pagesWs.addRow({ url: p.url, status: p.status || "", result: p.ok ? "Scanned" : "Failed", error: p.error ?? "", findings: p.findings });
  styleTable(pagesWs, pageCols, d.pages.length);

  const summary = (d.run.summary ?? {}) as { linksChecked?: number; rawFindings?: number; skipped?: { url: string; reason: string }[] };
  keyValueSheet(wb, "Audit Metadata", [
    ["Audit run ID", d.run.id],
    ["Start URL", d.run.start_url],
    ["Started", d.run.started_at ?? d.run.created_at],
    ["Finished", d.run.finished_at ?? ""],
    ["Viewports", (settings.viewports ?? []).map((v) => `${v}px`).join(", ")],
    ["Categories", (settings.categories ?? ["all"]).join(", ")],
    ["Max pages", settings.maxPages ?? ""],
    ["Delay between page loads", `${settings.delayMs ?? ""} ms`],
    ["Page selection", settings.urls?.length ? `Specific URL list (${settings.urls.length})` : "robots.txt + sitemap sampling"],
    ["Pages skipped", (summary.skipped ?? []).map((s) => `${s.url} (${s.reason})`).join("; ") || "None"],
    ["Internal links checked", summary.linksChecked ?? ""],
    ["Raw findings before grouping", summary.rawFindings ?? ""],
    ["Total findings in run", d.allIssueCount],
    ["Report filters", JSON.stringify(d.filters)],
    ["Authorization on record", `${d.project.authorization_note} (recorded ${d.project.authorized_at.slice(0, 10)})`],
    ["Approved design standards", Object.entries(d.project.standards).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("; ") || "Default baseline"],
    ["Generated", `${d.generatedAt} by ${d.generatedBy}`],
    ["Method", "Read-only: GET/HEAD requests only, robots.txt respected, no form submissions. Measurements from rendered DOM and computed CSS (Playwright); accessibility via axe-core."],
  ]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
