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
    const callsBefore = calls.length;
    expect(g.queuePsi(admin, projectId, { urls: [page], strategies: ["mobile"] })).toMatchObject({ queued: [], recentlyMeasured: 1 }); // served from the cache window
    expect(calls.length).toBe(callsBefore); // no Google call
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

describe("BUG-04: the 11:47 pattern (3 submissions in 12 s) queues each measurement once", () => {
  it("skips URL+devices still queued or measured within the cache window; skip-cache still runs once", async () => {
    run("UPDATE google_tasks SET status = 'completed' WHERE status IN ('pending', 'running')");
    respond = () => json(psiSample());
    const urls = ["https://capitalhomemortgage.com/b4-a/", "https://capitalhomemortgage.com/b4-b/"];
    const first = g.queuePsi(admin, projectId, { urls, strategies: ["mobile", "desktop"] });
    expect(first.queued).toHaveLength(4);
    for (const id of first.queued.slice(0, 2)) await g.processGoogleTask(id); // b4-a done, b4-b still queued

    const second = g.queuePsi(admin, projectId, { urls, strategies: ["mobile", "desktop"] });
    expect(second).toMatchObject({ queued: [], alreadyQueued: 2, recentlyMeasured: 2 });
    const third = g.queuePsi(admin, projectId, { urls, strategies: ["mobile", "desktop"] });
    expect(third.queued).toHaveLength(0);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM google_tasks WHERE json_extract(payload_json, '$.url') LIKE '%/b4-%'")!.n).toBe(4);

    // Explicit "skip the cache" re-measures a finished URL once, but never duplicates one still queued.
    const forced = g.queuePsi(admin, projectId, { urls, strategies: ["mobile", "desktop"], force: true });
    expect(forced).toMatchObject({ alreadyQueued: 2, recentlyMeasured: 0 });
    expect(forced.queued).toHaveLength(2);
  });
});

describe("BUG-05: real-user data scope on findings, and a dry-run impact report", async () => {
  const runsMod = await import("../server/runs");
  const scopeMod = await import("../server/google/cwv-scope");
  const field = (lcp: number) => ({ source: "psi-crux", scope: "url", metrics: { lcp: { p75: lcp, unit: "ms", category: "poor" } } });
  const origin = { source: "psi-crux", scope: "origin", metrics: { lcp: { p75: 4060, unit: "ms", category: "poor" } } };
  let runId = "";
  beforeAll(() => {
    runId = runsMod.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" } as never);
    runsMod.finishRun(runId, "completed");
    const pages = ["https://capitalhomemortgage.com/", "https://capitalhomemortgage.com/p2/", "https://capitalhomemortgage.com/p3/", "https://capitalhomemortgage.com/real/"];
    pages.forEach((u, n) => {
      const pageField = n < 3 ? field(4060) : field(2900); // three pages carry the site value; one has its own data
      run(`INSERT INTO psi_results (id, project_id, run_id, url, strategy, status, fetched_at, result_json) VALUES (?, ?, ?, ?, 'mobile', 'ok', ?, ?)`,
        newId(), projectId, runId, u, "2026-11-04T02:16:00.000Z", JSON.stringify({ scores: {}, lab: {}, field: pageField, originField: origin }));
      run(`INSERT INTO issues (id, run_id, project_id, code, fingerprint, type, rule, kind, severity, confidence, title, url, pages_json, viewports_json, current_value, recommendation, evidence_json, occurrences_json, captured_at, updated_at, provider)
           VALUES (?, ?, ?, ?, ?, 'cwv', 'crux:lcp', 'confirmed', 'high', 0.9, 'Poor real-user LCP on mobile', ?, ?, '[]', ?, 'x', ?, '[]', 't', 't', 'psi')`,
        newId(), runId, projectId, `CWV-000${n + 1}`, `fp${n}`, u, JSON.stringify([u]), n < 3 ? "4.1 s p75 (poor, LCP)" : "2.9 s p75 (poor, LCP)",
        JSON.stringify({ screenshots: [], boxes: [], computedCss: { provider: "psi", metricKey: "crux:lcp", strategy: "mobile" } }));
    });
  });

  it("labels each finding's data scope from the stored PageSpeed result", () => {
    const ids = all<{ id: string; code: string }>("SELECT id, code FROM issues WHERE run_id = ? ORDER BY code", runId);
    expect(scopeMod.cwvDataScope(ids[0].id)).toMatchObject({ scope: "origin", label: "Whole website (origin-level measurement)", samePages: 3 });
    expect(scopeMod.cwvDataScope(ids[3].id)).toMatchObject({ scope: "url", label: "This page (URL-level measurement)" });
  });

  it("dry-run: what consolidating whole-site findings would change, without changing anything", () => {
    const before = all("SELECT id, severity FROM issues WHERE run_id = ?", runId);
    const impact = scopeMod.originCwvImpact(runId);
    expect(impact).toMatchObject({ duplicateFindings: 2, groups: [{ metric: "lcp", strategy: "mobile", findings: 3, pages: 3 }], highNow: 4, highAfter: 2 });
    expect(all("SELECT id, severity FROM issues WHERE run_id = ?", runId)).toEqual(before);
  });
});

describe("BUG-11: project-aware references for quoted IDs", async () => {
  const { projectCode, issueReference } = await import("../server/issues");
  it("derives a short website code and a reference without touching stored IDs", () => {
    expect(projectCode("Capital Home Mortgage")).toBe("CHM");
    expect(projectCode("RedRiverModularHomes")).toBe("RRMH");
    expect(projectCode("acme")).toBe("ACME");
    expect(projectCode("A")).toBe("A");
    expect(issueReference("Capital Home Mortgage", "CNT-0001")).toBe("CHM-CNT-0001");
    expect(issueReference("RedRiverModularHomes", "CNT-0001")).toBe("RRMH-CNT-0001");
  });
});

describe("UX-03: review queue", async () => {
  const runsMod = await import("../server/runs");
  const issuesMod = await import("../server/issues");
  let runId = "";
  beforeAll(() => {
    runId = runsMod.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" } as never);
    const mk = (n: number) => ({
      id: `TAP-${String(n).padStart(4, "0")}`, type: "buttons", rule: n <= 3 ? "tap-target-small" : `rule-${n}`, kind: n % 5 === 0 ? "recommendation" : "confirmed",
      severity: n <= 8 ? "high" : "low", confidence: 0.9, title: `Finding ${n}`, fingerprint: `q${String(n).padStart(15, "0")}`,
      location: { url: "https://capitalhomemortgage.com/", pages: ["https://capitalhomemortgage.com/"], viewports: [390], selector: `.f${n}` },
      instanceCount: 1, occurrences: [], recommendation: "x", current: n <= 3 ? "20×20px" : `v${n}`, proposed: "44×44px",
      evidence: { screenshots: [], boxes: [], capturedAt: "t" }, review: { status: "pending", notes: "", reviewer: null },
    });
    runsMod.importResults(runId, Array.from({ length: 24 }, (_, k) => mk(k + 1)) as never, []);
    runsMod.finishRun(runId, "completed");
  });

  it("shows one unreviewed finding at a time, highest priority first, with progress", () => {
    const q = issuesMod.reviewQueue(admin, { runId }, 0)!;
    expect(q.item.severity).toBe("high");
    expect(q).toMatchObject({ remaining: 24, position: 0, reviewed: 0, total: 24 });
  });

  it("a reviewer classifies 20 findings without leaving the queue; progress persists; undo works", () => {
    for (let n = 0; n < 20; n++) {
      const q = issuesMod.reviewQueue(admin, { runId }, 0)!;
      issuesMod.reviewIssue(admin, q.item.id, { action: n % 4 === 0 ? "false_positive" : q.item.kind === "recommendation" ? "approve" : "confirm" });
    }
    const after = issuesMod.reviewQueue(admin, { runId }, 0)!;
    expect(after).toMatchObject({ remaining: 4, reviewed: 20, total: 24 });
    // Undo the last decision: the finding goes back into the queue.
    const last = all<{ id: string }>("SELECT id FROM issues WHERE run_id = ? AND verification_status = 'confirmed' ORDER BY updated_at DESC LIMIT 1", runId)[0].id;
    issuesMod.reviewIssue(admin, last, { action: "unverify" });
    expect(issuesMod.reviewQueue(admin, { runId }, 0)!.remaining).toBe(5);
  });

  it("offers grouped review only for genuinely equivalent findings (same rule and same measured value)", () => {
    const tapIds = all<{ id: string }>("SELECT id FROM issues WHERE run_id = ? AND rule = 'tap-target-small'", runId).map((r) => r.id);
    run(`UPDATE issues SET verification_status = 'unverified', review_status = 'pending' WHERE id IN (${tapIds.map(() => "?").join(",")})`, ...tapIds);
    const tap = issuesMod.reviewQueue(admin, { runId, q: "Finding 1" }, 0)!;
    expect(tap.item.rule).toBe("tap-target-small");
    expect(tap.similar).toHaveLength(2);
    expect(tap.similar).not.toContain(tap.item.id);
  });

  it("only reviewers can use the queue's actions", () => {
    const dev = auth.createUser({ email: "dev@example.com", name: "Dev", password: "correct horse battery", role: "developer" });
    projects.addMember(admin, projectId, dev.id);
    const q = issuesMod.reviewQueue(admin, { runId }, 0)!;
    expect(() => issuesMod.reviewIssue(dev, q.item.id, { action: "confirm" })).toThrow();
  });
});

describe("UX-02: one clear status vocabulary (display only)", async () => {
  const { statusWords } = await import("../server/issues");
  it("never shows 'Confirmed' next to 'Unverified'", () => {
    const w = statusWords({ kind: "confirmed", verification_status: "unverified", review_status: "pending", implementation_status: "todo", client_decision: null });
    expect(w).toEqual({ detected: "Measured problem", team: "Not reviewed yet", client: "No client decision", fix: "Not fixed yet" });
    expect(statusWords({ kind: "recommendation", verification_status: "unverified", review_status: "approved", implementation_status: "done", client_decision: "approved" }))
      .toEqual({ detected: "Recommendation", team: "Approved by your team", client: "Client approved", fix: "Fixed" });
    expect(statusWords({ kind: "needs-review", verification_status: "false_positive", review_status: "pending", implementation_status: "todo", client_decision: null }).team).toBe("False positive (not a real problem)");
  });
});
