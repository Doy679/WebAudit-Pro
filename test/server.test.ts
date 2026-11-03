import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Issue } from "../src/types.js";
import type { User } from "../server/auth";

const dir = mkdtempSync(join(tmpdir(), "webaudit-db-"));
process.env.WEBAUDIT_DATA_DIR = dir;

const { closeDb, get } = await import("../server/db");
const auth = await import("../server/auth");
const perms = await import("../server/permissions");
const projects = await import("../server/projects");
const runs = await import("../server/runs");
const issues = await import("../server/issues");
const approvals = await import("../server/approvals");

let admin: User, qa: User, dev: User, outsider: User;
let projectId: string;

function fakeIssue(code: string, over: Partial<Issue> = {}): Issue {
  return {
    id: code, type: "buttons", rule: "tap-target-small", kind: "confirmed", severity: "medium", confidence: 0.9, title: "Tap target too small",
    fingerprint: code.toLowerCase().padEnd(16, "0").slice(0, 16),
    location: { url: "https://capitalhomemortgage.com/", pages: ["https://capitalhomemortgage.com/"], viewports: [390], selector: ".cta" },
    instanceCount: 1, occurrences: [], current: "30×20px", proposed: "24×24px", recommendation: "Increase padding",
    evidence: { screenshots: [{ viewport: 390, path: "screenshots/home/390.png" }], boxes: [{ x: 0, y: 0, w: 30, h: 20 }], capturedAt: "2026-11-03T00:00:00Z" },
    review: { status: "pending", notes: "", reviewer: null }, ...over,
  };
}

beforeAll(async () => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  qa = auth.createUser({ email: "qa@example.com", name: "QA", password: "correct horse battery", role: "qa" });
  dev = auth.createUser({ email: "dev@example.com", name: "Dev", password: "correct horse battery", role: "developer" });
  outsider = auth.createUser({ email: "pm2@example.com", name: "Other PM", password: "correct horse battery", role: "pm" });
  projectId = projects.createProject(admin, {
    name: "Capital Home Mortgage", baseUrl: "https://capitalhomemortgage.com", authorizationConfirmed: true,
    authorizationNote: "Client contract, pilot scope",
  }).id;
  projects.addMember(admin, projectId, qa.id);
  projects.addMember(admin, projectId, dev.id);
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("auth", () => {
  it("hashes passwords and authenticates", () => {
    expect(auth.authenticate("admin@example.com", "correct horse battery")?.id).toBe(admin.id);
    expect(auth.authenticate("admin@example.com", "wrong password!!")).toBeNull();
    expect(get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", admin.id)!.password_hash).not.toContain("correct");
  });

  it("rejects short passwords and duplicate emails", () => {
    expect(() => auth.createUser({ email: "x@example.com", name: "X", password: "short", role: "qa" })).toThrow(/at least/);
    expect(() => auth.createUser({ email: "ADMIN@example.com", name: "Dup", password: "correct horse battery", role: "qa" })).toThrow(/already/);
  });

  it("issues sessions stored only as hashes, and expires them", () => {
    const token = auth.createSession(admin.id);
    expect(auth.sessionUser(token)?.id).toBe(admin.id);
    expect(get("SELECT 1 FROM sessions WHERE token_hash = ?", token)).toBeUndefined();
    auth.destroySession(token);
    expect(auth.sessionUser(token)).toBeNull();
    expect(auth.sessionUser("not-a-real-token")).toBeNull();
  });
});

describe("authorization", () => {
  it("isolates projects to members (admin sees all)", () => {
    expect(perms.canAccessProject(admin, projectId)).toBe(true);
    expect(perms.canAccessProject(qa, projectId)).toBe(true);
    expect(perms.canAccessProject(outsider, projectId)).toBe(false);
    expect(() => projects.getProject(outsider, projectId)).toThrow(perms.ForbiddenError);
    expect(projects.listProjects(outsider)).toEqual([]);
  });

  it("limits actions by role", () => {
    expect(perms.can(dev, "audit:start")).toBe(false);
    expect(perms.can(dev, "issue:implement")).toBe(true);
    expect(perms.can(qa, "issue:review")).toBe(true);
    expect(perms.can(qa, "users:manage")).toBe(false);
  });
});

describe("projects and audit scope", () => {
  it("requires an explicit authorization record", () => {
    expect(() => projects.createProject(admin, { name: "X", baseUrl: "https://redrivermodularhomes.com", authorizationConfirmed: false, authorizationNote: "n" }))
      .toThrow(/authoriz/i);
  });

  it("only allows audit URLs on the project's domain", async () => {
    await expect(runs.createAuditRun(admin, projectId, { startUrl: "https://moveuptherankings.com/" })).rejects.toThrow(/outside/);
    await expect(runs.createAuditRun(dev, projectId, { startUrl: "https://capitalhomemortgage.com/" })).rejects.toThrow(perms.ForbiddenError);
  });

  it("rejects internal addresses even if the domain matches", async () => {
    // Vitest enables the loopback test policy, so use a private range that stays blocked under any policy.
    const internal = projects.createProject(admin, { name: "Internal", baseUrl: "http://10.0.0.5:8080", authorizationConfirmed: true, authorizationNote: "test" });
    await expect(runs.createAuditRun(admin, internal.id, { startUrl: "http://10.0.0.5:8080/" })).rejects.toThrow(/private|internal/);
  });
});

describe("job queue and run results", () => {
  let runId: string;

  it("creates a pending run with a job, claims it exactly once", () => {
    runId = runs.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" });
    expect(runs.claimNextJob("audit")?.ref_id).toBe(runId);
    expect(runs.claimNextJob("audit")).toBeUndefined();
    expect(runs.getRun(admin, runId).status).toBe("running");
  });

  it("records cancellation requests", () => {
    runs.requestCancel(qa, runId);
    expect(runs.isCancelRequested(runId)).toBe(true);
  });

  it("imports grouped issues and carries over earlier false-positive decisions", () => {
    runs.importResults(runId, [fakeIssue("BTN-0001"), fakeIssue("BTN-0002")], [{ url: "https://capitalhomemortgage.com/", ok: true, status: 200 }]);
    const [first] = issues.listIssues(admin, { runId }).rows;
    issues.reviewIssue(qa, first.id, { action: "false_positive", note: "Hidden carousel dot" });

    const run2 = runs.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" });
    runs.importResults(run2, [fakeIssue("BTN-0001")], [{ url: "https://capitalhomemortgage.com/", ok: true, status: 200 }]);
    const carried = issues.listIssues(admin, { runId: run2 }).rows[0];
    expect(carried.verification_status).toBe("false_positive");
  });
});

describe("issue review", () => {
  it("filters, records history and persists assignments", () => {
    const runId = runs.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" });
    runs.importResults(runId, [fakeIssue("SPC-0001", { type: "spacing", rule: "section-padding-outlier", kind: "recommendation", severity: "low" }), fakeIssue("BTN-0009")], []);
    expect(issues.listIssues(admin, { runId, kind: "recommendation" }).total).toBe(1);
    expect(issues.listIssues(admin, { runId, q: "BTN-0009" }).total).toBe(1);

    const id = issues.listIssues(admin, { runId, kind: "recommendation" }).rows[0].id;
    issues.reviewIssue(qa, id, { action: "approve" });
    issues.reviewIssue(qa, id, { action: "assign", assigneeId: dev.id });
    issues.reviewIssue(qa, id, { action: "priority", priority: "high" });
    issues.reviewIssue(dev, id, { action: "implementation", status: "in_progress", note: "Working on it" });
    const detail = issues.getIssue(admin, id);
    expect(detail.review_status).toBe("approved");
    expect(detail.assignee_id).toBe(dev.id);
    expect(detail.implementation_status).toBe("in_progress");
    expect(detail.events.map((e) => e.action)).toEqual(["approve", "assign", "priority", "implementation"]);
  });

  it("stops developers from changing review decisions", () => {
    const id = issues.listIssues(admin, {}).rows[0].id;
    expect(() => issues.reviewIssue(dev, id, { action: "approve" })).toThrow(perms.ForbiddenError);
  });

  it("hides other projects' issues from non-members", () => {
    expect(issues.listIssues(outsider, {}).total).toBe(0);
    const id = issues.listIssues(admin, {}).rows[0].id;
    expect(() => issues.getIssue(outsider, id)).toThrow(perms.ForbiddenError);
  });
});

describe("client approvals", () => {
  let runId: string;
  let reviewed: string, unreviewed: string;

  beforeAll(() => {
    runId = runs.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" });
    runs.importResults(runId, [fakeIssue("LAY-0001", { type: "layout", rule: "horizontal-overflow" }), fakeIssue("LAY-0002", { type: "layout", rule: "text-clipped" })], []);
    const rows = issues.listIssues(admin, { runId }).rows;
    reviewed = rows[0].id;
    unreviewed = rows[1].id;
    issues.reviewIssue(qa, reviewed, { action: "confirm" });
  });

  it("only releases internally reviewed findings", () => {
    expect(() => approvals.createPackage(admin, { projectId, runId, issueIds: [unreviewed], title: "Batch 1", expiresInDays: 7 })).toThrow(/review/);
  });

  it("creates a token link stored as a hash, records client decisions with an audit trail", () => {
    const { token, packageId } = approvals.createPackage(admin, { projectId, runId, issueIds: [reviewed], title: "Batch 1", expiresInDays: 7 });
    expect(get("SELECT 1 FROM approval_packages WHERE token_hash = ?", token)).toBeUndefined();
    const view = approvals.openPackage(token);
    expect(view.status).toBe("open");
    expect(view.issues.map((i) => i.id)).toEqual([reviewed]);

    approvals.submitDecisions(token, { name: "Jane Client", email: "jane@client.com" },
      [{ issueId: reviewed, decision: "approved", comment: "Go ahead" }], { ip: "127.0.0.1", userAgent: "test" });
    const decision = get<{ decision: string; client_name: string }>("SELECT * FROM client_decisions WHERE package_id = ?", packageId)!;
    expect(decision).toMatchObject({ decision: "approved", client_name: "Jane Client" });
    expect(issues.getIssue(admin, reviewed).events.some((e) => e.action === "client_approved" && e.actor_label.includes("Jane Client"))).toBe(true);
  });

  it("rejects decisions for findings outside the package", () => {
    const { token } = approvals.createPackage(admin, { projectId, runId, issueIds: [reviewed], title: "Batch 2", expiresInDays: 7 });
    expect(() => approvals.submitDecisions(token, { name: "Jane", email: "jane@client.com" }, [{ issueId: unreviewed, decision: "approved", comment: "" }], {}))
      .toThrow(/not part/);
  });

  it("refuses revoked and expired links", () => {
    const a = approvals.createPackage(admin, { projectId, runId, issueIds: [reviewed], title: "Revoked", expiresInDays: 7 });
    approvals.revokePackage(admin, a.packageId);
    expect(approvals.openPackage(a.token).status).toBe("revoked");
    const b = approvals.createPackage(admin, { projectId, runId, issueIds: [reviewed], title: "Expired", expiresInDays: -1 });
    expect(approvals.openPackage(b.token).status).toBe("expired");
    expect(approvals.openPackage("garbage").status).toBe("invalid");
    expect(() => approvals.submitDecisions(b.token, { name: "J", email: "j@c.com" }, [{ issueId: reviewed, decision: "approved", comment: "" }], {})).toThrow(/expired/);
  });
});
