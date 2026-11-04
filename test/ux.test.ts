import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Issue } from "../src/types.js";
import type { User } from "../server/auth";

const dir = mkdtempSync(join(tmpdir(), "webaudit-ux-"));
process.env.WEBAUDIT_DATA_DIR = dir;

const { closeDb, run } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const runs = await import("../server/runs");
const issues = await import("../server/issues");
const { parseIssueSearchParams, QUICK_FILTERS } = await import("../server/issue-filters");
const { explainIssue } = await import("../server/explain");
const views = await import("../server/saved-views");
const onboarding = await import("../server/onboarding");
const approvals = await import("../server/approvals");
const perms = await import("../server/permissions");
const stats = await import("../server/stats");

let admin: User, other: User;
let projectId: string, runId: string;

const mk = (code: string, over: Partial<Issue>): Issue => ({
  id: code, type: "layout", rule: "horizontal-overflow", kind: "confirmed", severity: "medium", confidence: 0.9, title: code,
  fingerprint: code.toLowerCase().padEnd(16, "0").slice(0, 16),
  location: { url: "https://example.com/", pages: ["https://example.com/"], viewports: [390], selector: `.${code}` },
  instanceCount: 1, occurrences: [], recommendation: "Fix", current: "x", proposed: "y",
  evidence: { screenshots: [], boxes: [], capturedAt: "t" }, review: { status: "pending", notes: "", reviewer: null }, ...over,
});

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  other = auth.createUser({ email: "qa@example.com", name: "QA", password: "correct horse battery", role: "qa" });
  projectId = projects.createProject(admin, { name: "Example", baseUrl: "https://example.com", authorizationConfirmed: true, authorizationNote: "test" }).id;
  runId = runs.insertRun(admin, projectId, { startUrl: "https://example.com/" });
  runs.importResults(runId, [
    mk("M1", { location: { url: "https://example.com/", pages: ["https://example.com/"], viewports: [320, 390], selector: ".m1" }, severity: "high" }),
    mk("D1", { location: { url: "https://example.com/", pages: ["https://example.com/"], viewports: [1440], selector: ".d1" } }),
    mk("A1", { type: "a11y", rule: "axe:color-contrast", kind: "needs-review", location: { url: "https://example.com/", pages: ["https://example.com/"], viewports: [390, 1440], selector: ".a1" } }),
    mk("S1", { type: "seo", rule: "meta-description-missing", location: { url: "https://example.com/", pages: ["https://example.com/"], viewports: [1440] } }),
    mk("P1", { type: "spacing", rule: "section-padding-outlier", kind: "recommendation", severity: "low", location: { url: "https://example.com/", pages: ["https://example.com/"], viewports: [1440], selector: ".p1" } }),
  ], []);
  runs.finishRun(runId, "completed");
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

const codes = (f: ReturnType<typeof parseIssueSearchParams>) => issues.listIssues(admin, { ...f, runId, sort: "code" }).rows.map((r) => r.code).sort();

describe("quick filters", () => {
  it("each quick filter maps to real filters", () => {
    expect(QUICK_FILTERS.map((q) => q.key)).toEqual(["all", "high", "mobile", "desktop", "a11y", "seo", "layout", "confirmed", "recommendations", "review", "client"]);
    expect(codes(parseIssueSearchParams({ quick: "high" }))).toEqual(["M1"]);
    expect(codes(parseIssueSearchParams({ quick: "mobile" }))).toEqual(["A1", "M1"]);
    expect(codes(parseIssueSearchParams({ quick: "desktop" }))).toEqual(["A1", "D1", "P1", "S1"]);
    expect(codes(parseIssueSearchParams({ quick: "a11y" }))).toEqual(["A1"]);
    expect(codes(parseIssueSearchParams({ quick: "seo" }))).toEqual(["S1"]);
    expect(codes(parseIssueSearchParams({ quick: "layout" }))).toEqual(["D1", "M1", "P1"]);
    expect(codes(parseIssueSearchParams({ quick: "confirmed" }))).toEqual(["D1", "M1", "S1"]);
    expect(codes(parseIssueSearchParams({ quick: "review" }))).toEqual(["A1"]);
    expect(codes(parseIssueSearchParams({ quick: "all" }))).toHaveLength(5);
  });

  it("'pending client approval' lists released findings without a client decision", () => {
    const m1 = issues.listIssues(admin, { runId, q: "M1" }).rows[0].id;
    const d1 = issues.listIssues(admin, { runId, q: "D1" }).rows[0].id;
    issues.reviewIssue(admin, m1, { action: "confirm" });
    issues.reviewIssue(admin, d1, { action: "confirm" });
    const { token } = approvals.createPackage(admin, { projectId, runId, issueIds: [m1, d1], title: "Batch", expiresInDays: 7 });
    approvals.submitDecisions(token, { name: "Client", email: "c@example.com" }, [{ issueId: d1, decision: "approved", comment: "" }], {});
    expect(codes(parseIssueSearchParams({ quick: "client" }))).toEqual(["M1"]);
  });

  it("combines with other filters and ignores unknown quick keys", () => {
    expect(codes(parseIssueSearchParams({ quick: "mobile", severity: "high" }))).toEqual(["M1"]);
    expect(parseIssueSearchParams({ quick: "nope" })).toEqual({ sort: "severity", page: 1, pageSize: 50 });
  });
});

describe("plain-language explanations", () => {
  it("explains common rules without jargon and suggests who fixes it", () => {
    const e = explainIssue({ rule: "tap-target-small", type: "buttons", title: "Tap target below the 24px minimum" });
    expect(e.what).toMatch(/too small to tap/i);
    expect(e.why).toMatch(/phone/i);
    expect(e.who).toBe("Developer");
    expect(explainIssue({ rule: "meta-description-missing", type: "seo", title: "" }).who).toBe("Content editor");
    expect(explainIssue({ rule: "axe:color-contrast", type: "a11y", title: "" }).what).toMatch(/hard to read/i);
  });

  it("falls back to a sensible category explanation for any rule", () => {
    const e = explainIssue({ rule: "axe:some-new-rule", type: "a11y", title: "Elements must have something" });
    expect(e.what).toContain("Elements must have something");
    expect(e.why).toMatch(/assistive|screen reader|disabilit/i);
    for (const rule of ["psi:render-blocking-insight", "crux:lcp", "gsc:coverage", "schema:required", "section-padding-outlier"]) {
      expect(explainIssue({ rule, type: "performance", title: "x" }).what.length).toBeGreaterThan(10);
    }
  });
});

describe("saved views", () => {
  it("saves, lists and deletes a user's own views; others can't see or delete them", () => {
    const v = views.saveView(admin, "Mobile high priority", "quick=mobile&severity=high");
    expect(views.listViews(admin).map((x) => x.name)).toEqual(["Mobile high priority"]);
    expect(views.listViews(other)).toEqual([]);
    expect(() => views.deleteView(other, v.id)).toThrow(perms.NotFoundError);
    views.deleteView(admin, v.id);
    expect(views.listViews(admin)).toEqual([]);
  });

  it("only stores known filter parameters", () => {
    const v = views.saveView(admin, "Odd", "quick=seo&evil=<script>&page=4&severity=high");
    expect(v.query).toBe("quick=seo&severity=high");
    expect(() => views.saveView(admin, " ", "quick=seo")).toThrow(/name/);
  });
});

describe("onboarding checklist", () => {
  it("tracks real progress per user and can be dismissed permanently", () => {
    const fresh = auth.createUser({ email: "new@example.com", name: "New", password: "correct horse battery", role: "pm" });
    const s = onboarding.onboardingState(fresh);
    expect(s.dismissed).toBe(false);
    expect(s.steps.map((x) => x.done)).toEqual([false, false, false, false, false]);
    const a = onboarding.onboardingState(admin);
    expect(a.steps.find((x) => x.key === "project")!.done).toBe(true);
    expect(a.steps.find((x) => x.key === "audit")!.done).toBe(true);
    expect(a.steps.find((x) => x.key === "review")!.done).toBe(true);
    expect(a.steps.find((x) => x.key === "approval")!.done).toBe(true);
    onboarding.dismissOnboarding(fresh);
    expect(onboarding.onboardingState(fresh).dismissed).toBe(true);
    run("SELECT 1"); // keep db referenced
  });
});

describe("dashboard", () => {
  it("summarizes each website from its latest completed audit, scoped to the user", () => {
    const [w] = stats.websiteSummaries(admin);
    expect(w).toMatchObject({ name: "Example", domain: "example.com", lastRunId: runId, findings: 5, high: 1, needsReview: 1, active: null });
    expect(stats.websiteSummaries(other)).toEqual([]);
    expect(stats.overviewStats(admin)).toMatchObject({ reportsReady: 0, awaitingClient: 1 });
  });
});

describe("report preview", () => {
  it("counts exactly what a report with these options will contain", async () => {
    const { exportPreview } = await import("../server/exports");
    expect(exportPreview(admin, runId, {})).toEqual({ total: 5, high: 1, medium: 3, low: 1 });
    expect(exportPreview(admin, runId, { severity: "medium" }).total).toBe(3);
    expect(exportPreview(admin, runId, { reviewedOnly: true }).total).toBe(2); // M1, D1 confirmed earlier
    const ids = issues.listIssues(admin, { runId, q: "S1" }).rows.map((r) => r.id);
    expect(exportPreview(admin, runId, { ids }).total).toBe(1);
    expect(() => exportPreview(other, runId, {})).toThrow(perms.ForbiddenError);
  });
});

describe("plain-language coverage of real data", () => {
  // The most frequent accessibility rules in the Red River and CHM audits all get a specific explanation.
  it.each(["axe:aria-valid-attr-value", "axe:aria-prohibited-attr", "axe:listitem", "axe:aria-command-name", "axe:duplicate-id-aria",
    "axe:frame-title-unique", "axe:form-field-multiple-labels", "axe:aria-required-parent", "axe:frame-title", "axe:aria-required-children",
    "axe:bypass", "axe:scrollable-region-focusable", "axe:aria-allowed-attr"])("%s", (rule) => {
    const e = explainIssue({ rule, type: "a11y", title: "Technical axe title" });
    expect(e.what).not.toContain("Technical axe title");
    expect(e.what).not.toMatch(/aria|axe/i);
  });
});
