import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../server/auth";
import { psiSample } from "./fixtures/google/psi-sample";

const dir = mkdtempSync(join(tmpdir(), "webaudit-google-"));
process.env.WEBAUDIT_DATA_DIR = dir;
process.env.WEBAUDIT_SECRET = "test-secret-test-secret-test-secret-1234";

const { closeDb, get, all } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const runs = await import("../server/runs");
const issues = await import("../server/issues");
const config = await import("../server/google/config");
const g = await import("../server/google/service");
const perms = await import("../server/permissions");

let admin: User, outsider: User;
let projectId: string;
const calls: { url: string; init?: RequestInit }[] = [];
let respond: (url: string, init?: RequestInit) => Response;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  outsider = auth.createUser({ email: "pm@example.com", name: "Other PM", password: "correct horse battery", role: "pm" });
  projectId = projects.createProject(admin, { name: "CHM", baseUrl: "https://capitalhomemortgage.com", authorizationConfirmed: true, authorizationNote: "pilot" }).id;
  g.setGoogleFetch((async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as typeof fetch);
});
beforeEach(() => { calls.length = 0; });
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("credentials", () => {
  it("reports unconfigured integrations truthfully", () => {
    expect(config.googleStatus()).toMatchObject({ apiKeyConfigured: false, oauthConfigured: false });
    expect(() => g.queuePsi(admin, projectId, { urls: ["https://capitalhomemortgage.com/"], strategies: ["mobile"] })).toThrow(/API key/);
  });

  it("stores the API key and OAuth secret encrypted", () => {
    config.saveGoogleCredentials({ apiKey: `AIza${"T".repeat(35)}`, oauthClientId: "123-test.apps.googleusercontent.com", oauthClientSecret: "GOCSPX-secret" });
    const rows = all<{ key: string; value: string }>("SELECT key, value FROM app_settings WHERE key LIKE 'google.%'");
    expect(rows.find((r) => r.key === "google.apiKey")!.value).not.toContain(`AIza${"T".repeat(35)}`);
    expect(rows.find((r) => r.key === "google.oauthClientSecret")!.value).not.toContain("GOCSPX");
    expect(config.googleStatus()).toMatchObject({ apiKeyConfigured: true, oauthConfigured: true });
  });
});

describe("PageSpeed tasks", () => {
  it("only analyses URLs on the project's domain, within the per-project limit", () => {
    expect(() => g.queuePsi(admin, projectId, { urls: ["https://redrivermodularhomes.com/"], strategies: ["mobile"] })).toThrow(/outside/);
    g.setProjectLimits(admin, projectId, { psiMaxUrls: 2, inspectionMaxUrls: 5 });
    const urls = ["https://capitalhomemortgage.com/", "https://capitalhomemortgage.com/a/", "https://capitalhomemortgage.com/b/"];
    expect(() => g.queuePsi(admin, projectId, { urls, strategies: ["mobile"] })).toThrow(/at most 2/);
    expect(() => g.queuePsi(outsider, projectId, { urls: urls.slice(0, 1), strategies: ["mobile"] })).toThrow(perms.ForbiddenError);
  });

  it("runs queued requests, stores results with timestamps, and serves repeats from cache", async () => {
    respond = () => json(psiSample());
    const ids = g.queuePsi(admin, projectId, { urls: ["https://capitalhomemortgage.com/"], strategies: ["mobile", "desktop"] }).queued;
    expect(ids).toHaveLength(2);
    for (const id of ids) await g.processGoogleTask(id);
    expect(calls).toHaveLength(2);
    const latest = g.latestPsi(admin, projectId, "https://capitalhomemortgage.com/", "mobile")!;
    expect(latest.status).toBe("ok");
    expect(latest.result!.scores.performance).toBe(42);

    const again = g.queuePsi(admin, projectId, { urls: ["https://capitalhomemortgage.com/"], strategies: ["mobile"] }).queued;
    await g.processGoogleTask(again[0]);
    expect(calls).toHaveLength(2); // cached, no new request
    // BUG-04: a cache reuse for the same (unlinked) context adds no extra history row.
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM psi_results WHERE strategy = 'mobile'")!.n).toBe(1);
  });

  it("records quota errors as a clear unavailable state, without inventing scores", async () => {
    respond = () => json({ error: { code: 429, message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'" } }, 429);
    const [id] = g.queuePsi(admin, projectId, { urls: ["https://capitalhomemortgage.com/a/"], strategies: ["mobile"], force: true }).queued;
    await g.processGoogleTask(id);
    const r = g.latestPsi(admin, projectId, "https://capitalhomemortgage.com/a/", "mobile")!;
    expect(r).toMatchObject({ status: "error", error_kind: "quota", result: null });
  });

  it("creates provider findings for a linked audit run and updates them instead of duplicating", async () => {
    const runId = runs.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" });
    runs.importResults(runId, [], [{ url: "https://capitalhomemortgage.com/", ok: true, status: 200 }]);
    respond = () => json(psiSample());
    for (const pass of [1, 2]) {
      const [id] = g.queuePsi(admin, projectId, { urls: ["https://capitalhomemortgage.com/"], strategies: ["mobile"], runId, force: true }).queued;
      await g.processGoogleTask(id);
      const rows = issues.listIssues(admin, { runId, pageSize: 100 }).rows;
      expect(rows.filter((r) => r.metric_key === "render-blocking-insight")).toHaveLength(1);
      if (pass === 2) {
        const rb = rows.find((r) => r.metric_key === "render-blocking-insight")!;
        expect(rb).toMatchObject({ provider: "psi", kind: "recommendation", type: "performance" });
        expect(rb.code).toMatch(/^PERF-\d{4}$/);
        expect(rb.source_ref).toContain("pagespeed.web.dev");
      }
    }
  });
});

describe("Search Console connection", () => {
  it("runs OAuth with state + PKCE and stores only an encrypted refresh token", async () => {
    const start = g.startOAuth(admin);
    const auth = new URL(start.url);
    expect(auth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    respond = (url) => url.includes("oauth2.googleapis.com/token")
      ? json({ access_token: "ya29.ACCESS", expires_in: 3600, refresh_token: "1//REFRESH", scope: "https://www.googleapis.com/auth/webmasters.readonly" })
      : json({});
    await expect(g.completeOAuth(admin, { code: "C", state: "wrong", cookie: start.cookie })).rejects.toThrow(/state/i);
    const conn = await g.completeOAuth(admin, { code: "C", state: auth.searchParams.get("state")!, cookie: start.cookie });
    const row = get<{ refresh_token_enc: string; access_token_enc: string }>("SELECT * FROM google_connections WHERE id = ?", conn.id)!;
    expect(row.refresh_token_enc).not.toContain("REFRESH");
    expect(row.access_token_enc).not.toContain("ACCESS");
  });

  it("binds only an authorized property that matches the project's domain", async () => {
    const conn = g.listConnections(admin)[0];
    respond = () => json({ siteEntry: [
      { siteUrl: "sc-domain:capitalhomemortgage.com", permissionLevel: "siteFullUser" },
      { siteUrl: "sc-domain:redrivermodularhomes.com", permissionLevel: "siteOwner" },
      { siteUrl: "https://www.capitalhomemortgage.com/", permissionLevel: "siteUnverifiedUser" },
    ] });
    await expect(g.bindProperty(admin, projectId, conn.id, "sc-domain:redrivermodularhomes.com")).rejects.toThrow(/domain/);
    await expect(g.bindProperty(admin, projectId, conn.id, "https://www.capitalhomemortgage.com/")).rejects.toThrow(/access/i);
    await g.bindProperty(admin, projectId, conn.id, "sc-domain:capitalhomemortgage.com");
    expect(g.projectGoogle(admin, projectId)).toMatchObject({ gsc_property: "sc-domain:capitalhomemortgage.com", connection_id: conn.id });
    // Other users can't use someone else's Google connection.
    await expect(g.bindProperty(outsider, projectId, conn.id, "sc-domain:capitalhomemortgage.com")).rejects.toThrow();
  });

  it("fetches and caches Search Analytics with a previous-period comparison", async () => {
    respond = (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (!body.dimensions?.length) return json({ rows: [{ clicks: 120, impressions: 4000, ctr: 0.03, position: 14.2 }] });
      return json({ rows: [{ keys: [body.dimensions[0] === "date" ? "2026-10-01" : "x"], clicks: 5, impressions: 100, ctr: 0.05, position: 9 }] });
    };
    const [id] = g.queueGsc(admin, projectId, { kind: "performance", range: { startDate: "2026-10-04", endDate: "2026-10-31" } });
    await g.processGoogleTask(id);
    const perf = g.latestGsc(admin, projectId, "performance")!;
    expect(perf.status).toBe("ok");
    expect(perf.data.totals).toMatchObject({ clicks: 120, impressions: 4000 });
    expect(perf.data.previous.range).toEqual({ startDate: "2026-09-06", endDate: "2026-10-03" });
    expect(calls.every((c) => c.url.startsWith("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Acapitalhomemortgage.com/"))).toBe(true);
  });

  it("only inspects URLs inside the property, within limits, and stores Google-indexed fields", async () => {
    expect(() => g.queueGsc(admin, projectId, { kind: "inspection", urls: ["https://redrivermodularhomes.com/"] })).toThrow(/outside/);
    expect(() => g.queueGsc(admin, projectId, { kind: "inspection", urls: Array.from({ length: 6 }, (_, i) => `https://capitalhomemortgage.com/p${i}`) })).toThrow(/at most 5/);
    respond = () => json({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", lastCrawlTime: "2026-10-30T10:00:00Z", pageFetchState: "SUCCESSFUL" } } });
    const [id] = g.queueGsc(admin, projectId, { kind: "inspection", urls: ["https://capitalhomemortgage.com/"] });
    await g.processGoogleTask(id);
    const insp = g.inspections(admin, projectId)[0];
    expect(insp.data).toMatchObject({ verdict: "PASS", lastCrawlTime: "2026-10-30T10:00:00Z" });
  });

  it("shows a clear access-required error when Google denies the property", async () => {
    respond = () => json({ error: { code: 403, message: "User does not have sufficient permission for site 'sc-domain:capitalhomemortgage.com'." } }, 403);
    const [id] = g.queueGsc(admin, projectId, { kind: "sitemaps" });
    await g.processGoogleTask(id);
    expect(g.latestGsc(admin, projectId, "sitemaps")).toMatchObject({ status: "error" });
    expect(g.latestGsc(admin, projectId, "sitemaps")!.error).toMatch(/doesn.t have access to this Search Console property/);
  });

  it("disconnects: revokes at Google, deletes tokens and unbinds projects", async () => {
    const conn = g.listConnections(admin)[0];
    respond = () => new Response("", { status: 200 });
    await g.disconnect(admin, conn.id);
    expect(calls.some((c) => c.url === "https://oauth2.googleapis.com/revoke")).toBe(true);
    const row = get<{ refresh_token_enc: string; revoked_at: string }>("SELECT * FROM google_connections WHERE id = ?", conn.id)!;
    expect(row.revoked_at).toBeTruthy();
    expect(row.refresh_token_enc).toBe("");
    expect(g.projectGoogle(admin, projectId).connection_id).toBeNull();
    expect(() => g.queueGsc(admin, projectId, { kind: "sitemaps" })).toThrow(/Connect/);
  });
});
