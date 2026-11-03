import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../server/auth";

const dir = mkdtempSync(join(tmpdir(), "webaudit-scope-"));
process.env.WEBAUDIT_DATA_DIR = dir;
process.env.WEBAUDIT_WORKER_STALE_MS = "2000";

const { closeDb, get, run } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const runs = await import("../server/runs");
const scope = await import("../server/scope");
const ws = await import("../server/worker-status");

let admin: User;
let chm: string, redRiver: string;

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  chm = projects.createProject(admin, { name: "Capital Home Mortgage", baseUrl: "https://capitalhomemortgage.com", authorizationConfirmed: true, authorizationNote: "pilot" }).id;
  redRiver = projects.createProject(admin, { name: "RedRiverModularHomes", baseUrl: "https://redrivermodularhomes.com", authorizationConfirmed: true, authorizationNote: "client", settings: { maxPages: 80 } }).id;
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("project scope", () => {
  const rr = { name: "RedRiverModularHomes", domain: "redrivermodularhomes.com" };

  it("accepts the project's own domain with or without www", () => {
    expect(scope.urlInProjectScope(rr, "https://redrivermodularhomes.com/")).toBe(true);
    expect(scope.urlInProjectScope(rr, "https://www.redrivermodularhomes.com/floor-plans/")).toBe(true);
  });

  it("never matches by substring and excludes unapproved subdomains", () => {
    expect(scope.urlInProjectScope(rr, "https://capitalhomemortgage.com/")).toBe(false);
    expect(scope.urlInProjectScope(rr, "https://notredrivermodularhomes.com/")).toBe(false);
    expect(scope.urlInProjectScope(rr, "https://redrivermodularhomes.com.evil.net/")).toBe(false);
    expect(scope.urlInProjectScope(rr, "https://shop.redrivermodularhomes.com/")).toBe(false);
    expect(scope.urlInProjectScope({ ...rr, includeSubdomains: true }, "https://shop.redrivermodularhomes.com/")).toBe(true);
  });

  it("explains a mismatch by naming the selected project and the URL's domain", () => {
    expect(() => scope.assertUrlInProjectScope(rr, "https://capitalhomemortgage.com/"))
      .toThrow("You selected RedRiverModularHomes, but the entered URL belongs to capitalhomemortgage.com. Correct the URL or select the matching project.");
  });
});

describe("audit creation (server-side)", () => {
  it("rejects a URL from another project and creates no audit or job", async () => {
    const before = get<{ n: number }>("SELECT (SELECT COUNT(*) FROM audit_runs) + (SELECT COUNT(*) FROM jobs) AS n")!.n;
    await expect(runs.createAuditRun(admin, redRiver, { startUrl: "https://capitalhomemortgage.com/" })).rejects.toThrow(/You selected RedRiverModularHomes/);
    await expect(runs.createAuditRun(admin, redRiver, { startUrl: "https://redrivermodularhomes.com/", urls: ["https://capitalhomemortgage.com/rates/"] })).rejects.toThrow(/capitalhomemortgage\.com/);
    expect(get<{ n: number }>("SELECT (SELECT COUNT(*) FROM audit_runs) + (SELECT COUNT(*) FROM jobs) AS n")!.n).toBe(before);
  });

  it("stores the selected project, its URL and settings on the audit and job", () => {
    const id = runs.insertRun(admin, redRiver, { startUrl: "https://redrivermodularhomes.com/", maxPages: 7 });
    const r = get<{ project_id: string; start_url: string; settings_json: string }>("SELECT project_id, start_url, settings_json FROM audit_runs WHERE id = ?", id)!;
    expect(r.project_id).toBe(redRiver);
    expect(r.start_url).toBe("https://redrivermodularhomes.com/");
    expect(JSON.parse(r.settings_json).maxPages).toBe(7);
    expect(get("SELECT 1 FROM jobs WHERE ref_id = ? AND type = 'audit'", id)).toBeDefined();
  });

  it("refuses a second active audit of the same project (no duplicates from retries)", async () => {
    await expect(runs.createAuditRun(admin, redRiver, { startUrl: "https://redrivermodularhomes.com/" })).rejects.toThrow(/already queued or running/);
    // Another project is unaffected.
    const other = runs.insertRun(admin, chm, { startUrl: "https://capitalhomemortgage.com/" });
    expect(other).toBeTruthy();
  });
});

describe("worker status", () => {
  it("reports offline when no worker has ever started", () => {
    expect(ws.workerStatus().state).toBe("offline");
  });

  it("goes starting → online with a fresh heartbeat, and stale when heartbeats stop", async () => {
    const w = ws.registerWorker();
    expect(ws.workerStatus().state).toBe("starting");
    ws.beat(w, "online");
    expect(ws.workerStatus()).toMatchObject({ state: "online" });
    await new Promise((r) => setTimeout(r, 2200));
    expect(ws.workerStatus().state).toBe("stale");
  });

  it("refuses a second live worker so jobs are never processed twice", () => {
    const a = ws.registerWorker();
    ws.beat(a, "online");
    expect(() => ws.registerWorker()).toThrow(/already running/);
    ws.stopWorker(a);
    expect(ws.workerStatus().state).toBe("offline");
  });

  it("reports unhealthy when online but the running audit has stopped making progress", () => {
    const w = ws.registerWorker();
    const id = get<{ id: string }>("SELECT id FROM audit_runs WHERE project_id = ? AND status = 'pending'", chm)!.id;
    run("UPDATE audit_runs SET status = 'running', heartbeat_at = ? WHERE id = ?", new Date(Date.now() - 60 * 60_000).toISOString(), id);
    ws.beat(w, "online", id);
    expect(ws.workerStatus().state).toBe("unhealthy");
    run("UPDATE audit_runs SET status = 'pending', heartbeat_at = NULL WHERE id = ?", id);
    ws.stopWorker(w);
  });
});

describe("queue position and recovery", () => {
  it("tells a pending audit how many audits are ahead of it", () => {
    const rrRun = get<{ id: string }>("SELECT id FROM audit_runs WHERE project_id = ? AND status = 'pending'", redRiver)!.id;
    const chmRun = get<{ id: string }>("SELECT id FROM audit_runs WHERE project_id = ? AND status = 'pending'", chm)!.id;
    expect(runs.queuePosition(rrRun)).toBe(0);
    expect(runs.queuePosition(chmRun)).toBe(1);
  });

  it("requeues an audit interrupted by a worker crash instead of leaving it running, then fails it after repeated crashes", () => {
    const job = runs.claimNextJob("audit")!;
    expect(get<{ status: string }>("SELECT status FROM audit_runs WHERE id = ?", job.ref_id)!.status).toBe("running");
    expect(runs.recoverOrphanedRuns()).toEqual({ requeued: 1, failed: 0 });
    const r = get<{ status: string; error: string }>("SELECT status, error FROM audit_runs WHERE id = ?", job.ref_id)!;
    expect(r.status).toBe("pending");
    expect(r.error).toMatch(/requeued/i);

    for (let i = 0; i < 2; i++) {
      runs.claimNextJob("audit");
      runs.recoverOrphanedRuns();
    }
    const final = get<{ status: string; error: string }>("SELECT status, error FROM audit_runs WHERE id = ?", job.ref_id)!;
    expect(final.status).toBe("failed");
    expect(final.error).toMatch(/interrupted/i);
  });
});
