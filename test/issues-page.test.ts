// Regression tests for the Issues page crash (ORDER BY undefined from an empty `sort=` parameter)
// and for robust filtering, pagination and malformed stored data.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Issue } from "../src/types.js";
import type { User } from "../server/auth";

const dir = mkdtempSync(join(tmpdir(), "webaudit-issues-"));
process.env.WEBAUDIT_DATA_DIR = dir;

const { closeDb, run, newId, now } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const runs = await import("../server/runs");
const issues = await import("../server/issues");
const { parseIssueSearchParams } = await import("../server/issue-filters");
const perms = await import("../server/permissions");

let admin: User, outsider: User;
let rrProject: string, chmProject: string, rrRun: string, chmRun: string;

const EMPTY = { q: "", project: "", run: "", url: "", type: "", severity: "", viewport: "", kind: "", verification: "", review: "", assignee: "", provider: "", conf: "", sort: "" };

function issue(n: number, over: Partial<Issue> = {}): Issue {
  const sev = (["high", "medium", "low"] as const)[n % 3];
  return {
    id: `LAY-${String(n).padStart(4, "0")}`, type: n % 2 ? "layout" : "a11y", rule: n % 2 ? "horizontal-overflow" : "axe:color-contrast",
    kind: (["confirmed", "recommendation", "needs-review"] as const)[n % 3], severity: sev, confidence: (n % 10) / 10, title: `Finding ${n}`,
    fingerprint: `fp${String(n).padStart(14, "0")}`,
    location: { url: `https://redrivermodularhomes.com/p${n % 7}/`, pages: [`https://redrivermodularhomes.com/p${n % 7}/`], viewports: [n % 2 ? 390 : 1440], selector: `.el-${n}` },
    instanceCount: 1, occurrences: [{ url: "x", viewport: 390, screenshot: "s.png", boxes: [] }], current: `value ${n}`, proposed: "fixed", recommendation: "Fix it",
    evidence: { screenshots: [{ viewport: 390, path: "screenshots/a/390.png" }], boxes: [], capturedAt: "2026-11-03T00:00:00Z" },
    review: { status: "pending", notes: "", reviewer: null }, ...over,
  };
}

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  outsider = auth.createUser({ email: "qa@example.com", name: "QA", password: "correct horse battery", role: "qa" });
  rrProject = projects.createProject(admin, { name: "RedRiverModularHomes", baseUrl: "https://redrivermodularhomes.com", authorizationConfirmed: true, authorizationNote: "client" }).id;
  chmProject = projects.createProject(admin, { name: "Capital Home Mortgage", baseUrl: "https://capitalhomemortgage.com", authorizationConfirmed: true, authorizationNote: "pilot" }).id;
  rrRun = runs.insertRun(admin, rrProject, { startUrl: "https://redrivermodularhomes.com/" });
  // A large dataset: 2,000 grouped findings (Red River produced 750).
  runs.importResults(rrRun, Array.from({ length: 2000 }, (_, i) => issue(i + 1)), []);
  runs.finishRun(rrRun, "completed");
  chmRun = runs.insertRun(admin, chmProject, { startUrl: "https://capitalhomemortgage.com/" });
  runs.importResults(chmRun, [issue(1, { location: { url: "https://capitalhomemortgage.com/", pages: ["https://capitalhomemortgage.com/"], viewports: [390], selector: ".x" } })], []);
  runs.finishRun(chmRun, "completed");
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("search parameter parsing", () => {
  it("treats every empty parameter (the exact failing URL) as 'no filter' with the default sort", () => {
    expect(parseIssueSearchParams(EMPTY)).toEqual({ sort: "severity", page: 1, pageSize: 50 });
    expect(parseIssueSearchParams({})).toEqual({ sort: "severity", page: 1, pageSize: 50 });
  });

  it("ignores unknown or hostile values instead of passing them to SQL", () => {
    const f = parseIssueSearchParams({ sort: "severity; DROP TABLE issues", severity: "urgent", kind: "x", viewport: "abc", conf: "2", page: "-4", size: "99999", provider: "evil" });
    expect(f).toEqual({ sort: "severity", page: 1, pageSize: 200 });
  });

  it("keeps valid values", () => {
    expect(parseIssueSearchParams({ sort: "confidence", severity: "high", kind: "needs-review", viewport: "390", conf: "0.7", page: "3", size: "100", provider: "psi", q: "  menu  ", project: "p1" }))
      .toEqual({ sort: "confidence", severity: "high", kind: "needs-review", viewport: 390, minConfidence: 0.7, page: 3, pageSize: 100, provider: "psi", q: "menu", projectId: "p1" });
  });
});

describe("listIssues", () => {
  it("does not crash with an empty sort (the P0 bug) or an unknown sort key", () => {
    expect(() => issues.listIssues(admin, { sort: "" as never })).not.toThrow();
    expect(() => issues.listIssues(admin, { sort: "nope" as never })).not.toThrow();
    expect(issues.listIssues(admin, parseIssueSearchParams(EMPTY)).total).toBe(2001);
  });

  it("filters by project, run, category, severity, review status and provider", () => {
    expect(issues.listIssues(admin, { projectId: chmProject }).total).toBe(1);
    expect(issues.listIssues(admin, { runId: rrRun }).total).toBe(2000);
    expect(issues.listIssues(admin, { runId: rrRun, type: "layout" }).rows.every((r) => r.type === "layout")).toBe(true);
    expect(issues.listIssues(admin, { runId: rrRun, severity: "high" }).rows.every((r) => r.severity === "high")).toBe(true);
    expect(issues.listIssues(admin, { runId: rrRun, review: "pending" }).total).toBe(2000);
    expect(issues.listIssues(admin, { runId: rrRun, provider: "webaudit" }).total).toBe(2000);
    expect(issues.listIssues(admin, { runId: rrRun, provider: "psi" }).total).toBe(0);
  });

  it("sorts, searches and paginates", () => {
    const byConf = issues.listIssues(admin, { runId: rrRun, sort: "confidence", pageSize: 5 }).rows;
    expect(byConf.map((r) => r.confidence)).toEqual([...byConf.map((r) => r.confidence)].sort((a, b) => b - a));
    expect(issues.listIssues(admin, { runId: rrRun, q: "Finding 1999" }).rows.map((r) => r.title)).toEqual(["Finding 1999"]);
    const p1 = issues.listIssues(admin, { runId: rrRun, sort: "code", page: 1, pageSize: 50 });
    const p2 = issues.listIssues(admin, { runId: rrRun, sort: "code", page: 2, pageSize: 50 });
    expect(p1.rows).toHaveLength(50);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(100);
  });

  it("returns an empty page, not an error, when nothing matches or the page is past the end", () => {
    expect(issues.listIssues(admin, { runId: rrRun, q: "nothing like this" })).toMatchObject({ total: 0, rows: [] });
    expect(issues.listIssues(admin, { runId: rrRun, page: 999 }).rows).toEqual([]);
  });

  it("doesn't load the large per-occurrence evidence for list rows", () => {
    const row = issues.listIssues(admin, { runId: rrRun, pageSize: 1 }).rows[0] as unknown as Record<string, unknown>;
    expect(row.occurrences_json).toBeUndefined();
  });

  it("stays fast with 2,000 findings", () => {
    const t = performance.now();
    for (let i = 0; i < 10; i++) issues.listIssues(admin, { runId: rrRun, q: "Finding", sort: "severity", page: 3 });
    expect((performance.now() - t) / 10).toBeLessThan(100);
  });

  it("hides other projects' findings from users who aren't members", () => {
    expect(issues.listIssues(outsider, parseIssueSearchParams(EMPTY)).total).toBe(0);
    const id = issues.listIssues(admin, { projectId: chmProject }).rows[0].id;
    expect(() => issues.getIssue(outsider, id)).toThrow(perms.ForbiddenError);
  });
});

describe("whole-run aggregates (no silent 1,000-row cap)", () => {
  it("scores every finding in a large run, not just the first 1,000", () => {
    expect(issues.runScoreInputs(admin, rrRun)).toHaveLength(2000);
    expect(() => issues.runScoreInputs(outsider, rrRun)).toThrow(perms.ForbiddenError);
  });

  it("lists every internally reviewed finding for client release", () => {
    run("UPDATE issues SET verification_status = 'confirmed' WHERE run_id = ?", rrRun);
    run("UPDATE issues SET verification_status = 'false_positive' WHERE run_id = ? AND code = 'LAY-0001'", rrRun);
    const rows = issues.releasableIssues(admin, rrRun);
    expect(rows).toHaveLength(1999);
    expect(rows.some((r) => r.code === "LAY-0001")).toBe(false);
  });
});

describe("malformed or incomplete stored findings", () => {
  let bad: string;
  beforeAll(() => {
    bad = newId();
    run(`INSERT INTO issues (id, run_id, project_id, code, fingerprint, type, rule, kind, severity, confidence, title, url, pages_json, viewports_json,
           recommendation, evidence_json, occurrences_json, captured_at, updated_at)
         VALUES (?, ?, ?, 'LAY-9999', 'badbadbadbadbad0', 'layout', 'text-clipped', 'confirmed', 'high', 0.9, 'Broken record', 'https://redrivermodularhomes.com/x/',
           'not json', '{"oops":', '', '{broken', '', ?, ?)`, bad, rrRun, rrProject, now(), now());
  });

  it("one malformed finding doesn't break the list; it is shown with safe defaults and flagged", () => {
    const rows = issues.listIssues(admin, { runId: rrRun, q: "Broken record" }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pages: ["https://redrivermodularhomes.com/x/"], viewports: [], dataWarning: true });
    expect(rows[0].evidence.screenshots).toEqual([]);
  });

  it("the finding detail opens with missing optional evidence", () => {
    const d = issues.getIssue(admin, bad);
    expect(d.occurrences).toEqual([]);
    expect(d.evidence).toMatchObject({ screenshots: [], boxes: [] });
    expect(d.dataWarning).toBe(true);
  });

  it("filter dropdowns still work with malformed JSON present", () => {
    expect(() => issues.filterOptions(admin, rrRun)).not.toThrow();
  });
});
