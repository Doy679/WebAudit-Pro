// Runs the real worker process (tsx worker/worker.ts) against the local fixture site. No live websites.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { User } from "../server/auth";
import { startFixtureServer } from "./fixtureServer";

const dir = mkdtempSync(join(tmpdir(), "webaudit-worker-"));
process.env.WEBAUDIT_DATA_DIR = dir;
process.env.WEBAUDIT_WORKER_STALE_MS = "4000";

const { closeDb, get, all } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const runs = await import("../server/runs");
const ws = await import("../server/worker-status");

let site: Awaited<ReturnType<typeof startFixtureServer>>;
let admin: User;
let projectId: string;
const procs: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startWorker() {
  const p = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "worker/worker.ts"], {
    env: { ...process.env, WEBAUDIT_DATA_DIR: dir, WEBAUDIT_TEST_ALLOW_LOOPBACK: "1", WEBAUDIT_WORKER_STALE_MS: "4000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  p.stdout.on("data", (d: Buffer) => (out += d));
  p.stderr.on("data", (d: Buffer) => (out += d));
  procs.push(p);
  return { p, output: () => out };
}

function kill(p: ChildProcess) {
  if (!p.pid) return;
  if (process.platform === "win32") {
    try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ }
  } else p.kill("SIGKILL");
}

async function waitFor<T>(what: string, fn: () => T | undefined | false, timeoutMs = 60_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const status = (id: string) => get<{ status: string; pages_done: number; pages_total: number; findings: number; phase: string | null; error: string | null }>(
  "SELECT status, pages_done, pages_total, findings, phase, error FROM audit_runs WHERE id = ?", id)!;

beforeAll(async () => {
  site = await startFixtureServer();
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  projectId = projects.createProject(admin, { name: "Fixture", baseUrl: site.origin, authorizationConfirmed: true, authorizationNote: "test fixture" }).id;
});

afterAll(async () => {
  procs.forEach(kill);
  await site?.close();
  closeDb();
  await sleep(500);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

describe("audit worker (real process)", () => {
  let first: ReturnType<typeof startWorker>;

  it("Test 4: is offline before it starts, then registers and reports online", async () => {
    expect(ws.workerStatus().state).toBe("offline");
    first = startWorker();
    await waitFor("worker online", () => ws.workerStatus().state === "online", 30_000);
  }, 60_000);

  it("refuses to start a second worker while one is alive", async () => {
    const second = startWorker();
    const code = await new Promise<number | null>((r) => second.p.on("exit", r));
    expect(code).toBe(1);
    expect(second.output()).toMatch(/already running/);
  }, 60_000);

  it("Test 5: processes an audit pending → running → completed with real progress", async () => {
    const id = runs.insertRun(admin, projectId, { startUrl: `${site.origin}/`, viewports: [1440], delayMs: 500, categories: ["layout", "seo"] });
    expect(status(id).status).toBe("pending");
    const seen = new Set<string>();
    await waitFor("completed", () => { const s = status(id); seen.add(s.status); return s.status === "completed" || s.status === "failed"; }, 120_000);
    expect(seen.has("running")).toBe(true);
    const s = status(id);
    expect(s).toMatchObject({ status: "completed", pages_done: 2, pages_total: 2 });
    expect(s.findings).toBeGreaterThan(0);
    // Evidence and findings belong to this run and project only.
    expect(all("SELECT 1 FROM issues WHERE run_id = ? AND project_id != ?", id, projectId)).toHaveLength(0);
  }, 180_000);

  it("Tests 6–7: when the worker dies mid-audit it shows offline; on restart the audit is requeued and completes once", async () => {
    const id = runs.insertRun(admin, projectId, { startUrl: `${site.origin}/`, viewports: [390, 1440], delayMs: 2500, categories: ["layout", "seo"] });
    await waitFor("running", () => status(id).status === "running", 60_000);
    kill(first.p);
    await waitFor("worker offline", () => ["stale", "offline"].includes(ws.workerStatus().state), 15_000);
    expect(status(id).status).toBe("running"); // the database can't know yet; the UI uses the worker status to say it's stalled

    startWorker();
    await waitFor("requeued", () => status(id).status !== "running", 30_000);
    await waitFor("completed", () => status(id).status === "completed", 120_000);
    const job = get<{ attempts: number; status: string }>("SELECT attempts, status FROM jobs WHERE ref_id = ?", id)!;
    expect(job).toMatchObject({ attempts: 2, status: "completed" });
    const counts = get<{ n: number; fps: number }>("SELECT COUNT(*) AS n, COUNT(DISTINCT fingerprint) AS fps FROM issues WHERE run_id = ?", id)!;
    expect(counts.n).toBe(counts.fps); // no duplicated findings
    expect(counts.n).toBe(status(id).findings);
    expect(ws.workerStatus().state).toBe("online");
  }, 240_000);

  it("never audits URLs outside the project, even if a stored setting was tampered with", async () => {
    const id = runs.insertRun(admin, projectId, { startUrl: `${site.origin}/` });
    // Simulate a corrupted/tampered record pointing at another domain.
    (await import("../server/db")).run("UPDATE audit_runs SET settings_json = json_set(settings_json, '$.startUrl', 'https://capitalhomemortgage.com/') WHERE id = ?", id);
    await waitFor("finished", () => ["completed", "failed"].includes(status(id).status), 60_000);
    expect(status(id)).toMatchObject({ status: "failed" });
    expect(status(id).error).toMatch(/You selected Fixture, but the entered URL belongs to capitalhomemortgage\.com/);
  }, 90_000);
});
