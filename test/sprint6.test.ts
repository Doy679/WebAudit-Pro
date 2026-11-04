// Sprint 6 regression tests (retest 2026-11-04: NEW-01…07 and reopened BUG-xx). No live Google traffic: fetch is mocked.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../server/auth";
import { psiSample } from "./fixtures/google/psi-sample";

const dir = mkdtempSync(join(tmpdir(), "webaudit-s6-"));
process.env.WEBAUDIT_DATA_DIR = dir;
process.env.WEBAUDIT_SECRET = "test-secret-test-secret-test-secret-1234";

const { closeDb, run, get, all, newId } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const config = await import("../server/google/config");
const g = await import("../server/google/service");
const psiMod = await import("../server/google/psi");
const { pageSpeedHealth } = await import("../server/google/health-status");

let admin: User, qa: User;
let projectId: string;
let respond: (url: string) => Response;
const calls: string[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const KEY = "AIzaSyTESTKEY-never-shown-1234567890";

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  qa = auth.createUser({ email: "qa@example.com", name: "QA", password: "correct horse battery", role: "qa" });
  projectId = projects.createProject(admin, { name: "CHM", baseUrl: "https://capitalhomemortgage.com", authorizationConfirmed: true, authorizationNote: "pilot" }).id;
  projects.addMember(admin, projectId, qa.id);
  g.setGoogleFetch((async (url: string | URL | Request) => { calls.push(String(url)); return respond(String(url)); }) as typeof fetch);
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

const google = (status: number, message: string, reason?: string, extra: Record<string, unknown> = {}) =>
  ({ error: { code: status, message, status: status === 400 ? "INVALID_ARGUMENT" : "PERMISSION_DENIED", ...(reason ? { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, metadata: extra }] } : {}) } });

describe("NEW-01: PageSpeed error classification", () => {
  it("separates a rejected key, a disabled API, key restrictions, quota, outages and page problems", () => {
    expect(psiMod.classifyPsiError(400, google(400, "API key not valid. Please pass a valid API key.", "API_KEY_INVALID")).kind).toBe("key-rejected");
    expect(psiMod.classifyPsiError(400, google(400, "API key expired. Please renew the API key.", "API_KEY_EXPIRED")).kind).toBe("key-rejected");
    const off = psiMod.classifyPsiError(403, google(403, "PageSpeed Insights API has not been used in project 154245030857 before or it is disabled.", "SERVICE_DISABLED", { consumer: "projects/154245030857" }));
    expect(off.kind).toBe("api-disabled");
    expect(off.message).toMatch(/turned off in Google Cloud \(project 154245030857\)/);
    expect(psiMod.classifyPsiError(403, google(403, "Requests from referer <empty> are blocked.", "API_KEY_HTTP_REFERRER_BLOCKED")).kind).toBe("key-restricted");
    expect(psiMod.classifyPsiError(429, google(429, "Quota exceeded for quota metric 'Queries' per day")).kind).toBe("quota");
    expect(psiMod.classifyPsiError(503, {}).kind).toBe("transient");
    expect(psiMod.classifyPsiError(400, google(400, "Lighthouse returned error: NO_FCP")).kind).toBe("page");
  });

  it("never puts the API key in a message or technical detail", () => {
    const e = psiMod.classifyPsiError(400, google(400, `API key not valid. Please pass a valid API key. key=${KEY}`, "API_KEY_INVALID"));
    expect(`${e.message} ${e.technical}`).not.toContain(KEY);
  });
});

describe("NEW-01: one PageSpeed health state, from fresh results only", () => {
  const page = "https://capitalhomemortgage.com/";
  const runTask = async (url = page, force = false) => {
    const { queued } = g.queuePsi(admin, projectId, { urls: [url], strategies: ["mobile"], force });
    return g.processGoogleTask(queued[0]);
  };

  it("not configured → configured but untested", () => {
    expect(pageSpeedHealth(admin).state).toBe("not-configured");
    config.saveGoogleCredentials({ apiKey: KEY });
    expect(pageSpeedHealth(admin)).toMatchObject({ state: "untested", label: expect.stringMatching(/not tested yet/i) });
  });

  it("a fresh success makes it healthy; a cache hit is not proof the key still works", async () => {
    respond = () => json(psiSample());
    expect(await runTask()).toBe("completed");
    const ok = pageSpeedHealth(admin);
    expect(ok.state).toBe("ok");
    const okAt = ok.lastSuccess!;

    // Later the key is rejected for a new URL, while the cached URL still "completes" from cache.
    respond = () => json(google(400, "API key not valid. Please pass a valid API key.", "API_KEY_INVALID"), 400);
    expect(await runTask("https://capitalhomemortgage.com/gbg-team/")).toBe("failed");
    expect(await runTask()).toBe("completed"); // cache hit, no Google call
    const h = pageSpeedHealth(admin);
    expect(h.state).toBe("failing");
    expect(h.failureKind).toBe("key-rejected");
    expect(h.label).toMatch(/last live request failed: API key rejected/i);
    expect(h.lastSuccess).toBe(okAt); // the cache hit didn't move "last success"
    expect(h.detail).toMatch(/earlier results stay available/i);
    expect(JSON.stringify(h)).not.toContain(KEY);
    expect(pageSpeedHealth(qa).technical).toBeUndefined(); // raw Google text is admin-only
  });

  it("recognises failures stored by older versions (error_kind 'config', 'key was rejected')", () => {
    run(`INSERT INTO psi_results (id, project_id, url, strategy, status, error, error_kind, fetched_at) VALUES (?, ?, ?, 'mobile', 'error', ?, 'config', ?)`,
      newId(), projectId, "https://capitalhomemortgage.com/old/", "The PageSpeed Insights API key was rejected. Check it in Google Connections.", new Date().toISOString());
    expect(pageSpeedHealth(admin)).toMatchObject({ state: "failing", failureKind: "key-rejected" });
  });

  it("saving a new key starts a fresh 'untested' state; a page-specific problem is not an integration failure", async () => {
    config.saveGoogleCredentials({ apiKey: "AIzaSyREPLACEDKEY000000000000000000000" });
    expect(pageSpeedHealth(admin).state).toBe("untested");
    respond = () => json(google(400, "Lighthouse returned error: NO_FCP"), 400);
    expect(await runTask("https://capitalhomemortgage.com/blank/", true)).toBe("failed");
    expect(pageSpeedHealth(admin).state).toBe("untested");
  });

  it("network failures and quota are reported as such", async () => {
    respond = () => { throw new TypeError("fetch failed"); };
    const id = g.queuePsi(admin, projectId, { urls: ["https://capitalhomemortgage.com/net/"], strategies: ["desktop"], force: true }).queued[0];
    await g.processGoogleTask(id, { retries: 0 });
    expect(pageSpeedHealth(admin).failureKind).toBe("network");
    respond = () => json(google(429, "Quota exceeded for quota metric 'Queries' per day"), 429);
    await runTask("https://capitalhomemortgage.com/q/", true);
    expect(pageSpeedHealth(admin)).toMatchObject({ failureKind: "quota", label: expect.stringMatching(/quota/i) });
  });
});

describe("NEW-01: Test PageSpeed key needs an admin and a deliberate confirmation", () => {
  it("refuses without confirmation or for non-admins; with both, makes exactly one request", async () => {
    respond = () => json(psiSample());
    const before = calls.length;
    await expect(g.testPageSpeedKey(admin, projectId, false)).rejects.toThrow(/confirm/i);
    await expect(g.testPageSpeedKey(qa, projectId, true)).rejects.toThrow();
    expect(calls.length).toBe(before);
    await expect(g.testPageSpeedKey(admin, projectId, true)).resolves.toMatchObject({ ok: true });
    expect(calls.length).toBe(before + 1);
    expect(pageSpeedHealth(admin).state).toBe("ok");
  });
});

// Keep references used by later sprint additions.
void all; void get;
