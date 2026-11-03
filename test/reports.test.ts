import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { Issue } from "../src/types.js";
import type { User } from "../server/auth";
import type { ExportFormat, ExportFilters } from "../server/exports";

const dir = mkdtempSync(join(tmpdir(), "webaudit-reports-"));
process.env.WEBAUDIT_DATA_DIR = dir;

const { closeDb, get } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const runs = await import("../server/runs");
const issues = await import("../server/issues");
const exportsSvc = await import("../server/exports");
const { processExport } = await import("../worker/export-job");

let admin: User;
let runId: string;

const issue = (code: string, over: Partial<Issue> = {}): Issue => ({
  id: code, type: "spacing", rule: "section-padding-outlier", kind: "recommendation", severity: "medium", confidence: 0.8,
  title: "Section top spacing differs from the rest of the site", fingerprint: code.toLowerCase().padEnd(16, "0").slice(0, 16),
  location: { url: "https://capitalhomemortgage.com/loans/", pages: ["https://capitalhomemortgage.com/loans/"], viewports: [1440], selector: ".elementor-element-abc123", elementorId: "abc123" },
  instanceCount: 1, occurrences: [], current: "padding-top: 80px", proposed: "padding-top: 48px (token nearest the site median of 49px)",
  recommendation: "Align this section's spacing. In Elementor: edit element abc123 → Advanced → Padding.",
  evidence: { screenshots: [{ viewport: 1440, path: "screenshots/loans/1440.png" }], boxes: [{ x: 0, y: 100, w: 1440, h: 400 }], capturedAt: "2026-11-03T02:45:00Z" },
  review: { status: "pending", notes: "", reviewer: null }, ...over,
});

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  const p = projects.createProject(admin, { name: "Capital Home Mortgage", baseUrl: "https://capitalhomemortgage.com", authorizationConfirmed: true, authorizationNote: "Pilot contract" });
  runId = runs.insertRun(admin, p.id, { startUrl: "https://capitalhomemortgage.com/" });
  runs.claimNextJob("audit");
  runs.importResults(runId, [
    issue("SPC-0001"),
    issue("LAY-0001", { type: "layout", rule: "horizontal-overflow", kind: "confirmed", severity: "high", title: "Page scrolls sideways", current: "document width 624px at 390px viewport", proposed: "document width ≤ 390px" }),
    issue("CNT-0001", { type: "content", rule: "suspected-misspelling", kind: "needs-review", severity: "low", title: "Possible spelling mistake", current: '"recieve"', proposed: '"receive"' }),
  ], [{ url: "https://capitalhomemortgage.com/loans/", ok: true, status: 200 }, { url: "https://capitalhomemortgage.com/broken/", ok: false, status: 404, error: "HTTP 404" }]);
  runs.finishRun(runId, "completed", undefined, { startedAt: "2026-11-03T02:40:00Z" });
  const lay = issues.listIssues(admin, { runId, q: "LAY-0001" }).rows[0];
  issues.reviewIssue(admin, lay.id, { action: "confirm" });
  issues.reviewIssue(admin, lay.id, { action: "assign", assigneeId: admin.id });
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function generate(format: ExportFormat, filters?: ExportFilters) {
  const id = exportsSvc.createExport(admin, { runId, format, filters });
  const status = await processExport(id, () => {});
  const row = exportsSvc.getExport(admin, id);
  expect(status, row.error ?? "").toBe("completed");
  return row;
}

describe("Excel report", () => {
  it("has the eight required sheets with styled, filterable, frozen headers and real data", async () => {
    const row = await generate("xlsx");
    expect(row.file_name).toMatch(/\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(row.file_path!);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Executive Overview", "All Issues", "Confirmed Issues", "Recommendations", "Needs Review", "Developer Action Tracker", "Pages Audited", "Audit Metadata",
      "Google SEO Overview", "PageSpeed Mobile", "PageSpeed Desktop", "Performance Opportunities", "Core Web Vitals",
      "Structured Data Findings", "Search Console Performance", "URL Inspection", "Sitemap Status",
    ]);

    const all = wb.getWorksheet("All Issues")!;
    const header = (all.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(expect.arrayContaining(["Issue ID", "Page URL", "Category", "Severity", "Confidence", "Viewport", "Element / Selector",
      "Current", "Proposed", "Recommended Fix", "Evidence Reference", "Status", "Assignee", "Notes", "Source"]));
    expect(all.getRow(1).font?.bold).toBe(true);
    expect(all.autoFilter).toBeTruthy();
    expect(all.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(all.rowCount).toBe(4);

    const ids = all.getColumn(1).values.slice(2);
    expect(ids).toEqual(expect.arrayContaining(["LAY-0001", "SPC-0001", "CNT-0001"]));
    const urlCell = all.getRow(2).getCell(header.indexOf("Page URL") + 1);
    expect((urlCell.value as { hyperlink: string }).hyperlink).toMatch(/^https:\/\/capitalhomemortgage\.com\//);

    expect(wb.getWorksheet("Confirmed Issues")!.rowCount).toBe(2);
    expect(wb.getWorksheet("Needs Review")!.rowCount).toBe(2);
    const pages = wb.getWorksheet("Pages Audited")!;
    const pageUrls = pages.getColumn(1).values.slice(2).map((v) => (v as { text?: string })?.text ?? v);
    expect(pageUrls).toEqual(expect.arrayContaining(["https://capitalhomemortgage.com/broken/"]));
    const overview = wb.getWorksheet("Executive Overview")!;
    const text = overview.getSheetValues().flat().map(String).join(" ");
    expect(text).toContain("Capital Home Mortgage");
    expect(text).toMatch(/Pages scanned.*1/);
  });

  it("exports only the selected findings when filtered", async () => {
    const row = await generate("xlsx", { kind: "confirmed" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(row.file_path!);
    expect(wb.getWorksheet("All Issues")!.rowCount).toBe(2);
    expect(row.issue_count).toBe(1);
  });
});

describe("Google data in reports", () => {
  it("includes real PageSpeed numbers with units and timestamps, and says 'No data' where a source didn't run", async () => {
    const { psiSample } = await import("./fixtures/google/psi-sample");
    const { parsePsi } = await import("../server/google/psi");
    const { run: exec, newId } = await import("../server/db");
    const result = parsePsi(psiSample(), "mobile");
    exec(`INSERT INTO psi_results (id, project_id, run_id, url, strategy, status, fetched_at, analysis_ts, lighthouse_version, result_json) VALUES (?, (SELECT project_id FROM audit_runs WHERE id = ?), ?, ?, 'mobile', 'ok', ?, ?, ?, ?)`,
      newId(), runId, runId, "https://capitalhomemortgage.com/loans/", "2026-11-03T05:00:00Z", result.analysisTimestamp, result.lighthouseVersion, JSON.stringify(result));
    const row = await generate("xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(row.file_path!);
    const mobile = wb.getWorksheet("PageSpeed Mobile")!;
    const header = (mobile.getRow(1).values as unknown[]).slice(1);
    const values = (mobile.getRow(2).values as unknown[]).slice(1);
    const cell = (h: string) => values[header.indexOf(h)];
    expect(cell("Performance")).toBe(42);
    expect(cell("LCP (ms, lab)")).toBe(6230.4);
    expect(cell("Analysed (UTC)")).toBe("2026-11-03T05:00:00.000Z");
    expect(cell("Field LCP p75 (ms)")).toBe(3100);
    expect(String((wb.getWorksheet("PageSpeed Desktop")!.getRow(2).values as unknown[])[1])).toMatch(/No data/);
    expect(String((wb.getWorksheet("Search Console Performance")!.getRow(2).values as unknown[])[1])).toMatch(/No data: Search Console is not connected/);
    const opp = wb.getWorksheet("Performance Opportunities")!.getColumn(3).values.slice(2);
    expect(opp).toEqual(expect.arrayContaining(["render-blocking-insight", "image-delivery-insight"]));
  });

  it("adds a Google SEO & Performance section to the client report", async () => {
    const html = readFileSync((await generate("html")).file_path!, "utf8");
    expect(html).toContain("Google SEO &amp; Performance");
    expect(html).toContain("Lighthouse lab");
    expect(html).toMatch(/Search Console: not connected/);
  });
});

describe("PDF, HTML and JSON reports", () => {
  it("produces a real multi-page PDF", async () => {
    const row = await generate("pdf");
    const buf = readFileSync(row.file_path!);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThan(2);
  }, 120_000);

  it("produces a self-contained HTML report and JSON with the same findings", async () => {
    const html = readFileSync((await generate("html")).file_path!, "utf8");
    for (const section of ["Executive summary", "Audit scope", "Findings by severity", "Current vs Proposed", "Methodology and limitations", "Next steps"]) {
      expect(html).toContain(section);
    }
    expect(html).toContain("LAY-0001");
    const json = JSON.parse(readFileSync((await generate("json")).file_path!, "utf8"));
    expect(json.issues.map((i: { code: string }) => i.code).sort()).toEqual(["CNT-0001", "LAY-0001", "SPC-0001"]);
    expect(json.project.name).toBe("Capital Home Mortgage");
    // Parsed values only: no raw database JSON columns duplicated as strings.
    for (const k of ["occurrences_json", "pages_json", "viewports_json", "evidence_json"]) expect(json.issues[0][k]).toBeUndefined();
  });

  it("stores files outside any public directory", async () => {
    const row = await generate("json");
    expect(row.file_path!.startsWith(join(dir, "exports"))).toBe(true);
    expect(existsSync(row.file_path!)).toBe(true);
    expect(get("SELECT status FROM jobs WHERE ref_id = ?", row.id)).toBeDefined();
  });
});
