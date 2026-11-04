// Regression tests for the 2026-11-04 browser QA findings (BUG-xx / UX-xx in docs/agile/browser_qa_2026-11-04).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../server/auth";

const dir = mkdtempSync(join(tmpdir(), "webaudit-qa-"));
process.env.WEBAUDIT_DATA_DIR = dir;
process.env.WEBAUDIT_SECRET = "test-secret-test-secret-test-secret-1234";

const { closeDb, run, newId } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const g = await import("../server/google/service");
const perms = await import("../server/permissions");

let admin: User, outsider: User;
let projectId: string;

const psi = (url: string, strategy: "mobile" | "desktop", fetchedAt: string, score: number, status: "ok" | "error" = "ok") =>
  run(`INSERT INTO psi_results (id, project_id, url, strategy, status, fetched_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    newId(), projectId, url, strategy, status, fetchedAt, status === "ok" ? JSON.stringify({ scores: { performance: score } }) : null);

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  outsider = auth.createUser({ email: "pm@example.com", name: "Other PM", password: "correct horse battery", role: "pm" });
  projectId = projects.createProject(admin, { name: "CHM", baseUrl: "https://capitalhomemortgage.com", authorizationConfirmed: true, authorizationNote: "pilot" }).id;
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("BUG-03: latest PageSpeed result per URL + device", () => {
  it("returns the newest completed result for each URL and device, not the oldest", () => {
    const home = "https://capitalhomemortgage.com/";
    psi(home, "mobile", "2026-11-04T02:07:00.000Z", 59); // oldest (what the PageSpeed table wrongly showed)
    psi(home, "mobile", "2026-11-04T02:10:00.000Z", 55);
    psi(home, "mobile", "2026-11-04T02:15:00.000Z", 52); // newest
    psi(home, "desktop", "2026-11-04T02:07:00.000Z", 72);
    psi(home, "desktop", "2026-11-04T02:16:00.000Z", 80);
    const latest = g.latestPsiPerKey(admin, projectId);
    const pick = (s: string) => latest.find((r) => r.url === home && r.strategy === s)!;
    expect(latest).toHaveLength(2);
    expect(pick("mobile").result!.scores.performance).toBe(52);
    expect(pick("mobile").fetched_at).toBe("2026-11-04T02:15:00.000Z");
    expect(pick("desktop").result!.scores.performance).toBe(80);
  });

  it("breaks identical timestamps by insertion order and prefers a completed result over a newer failure", () => {
    const u = "https://capitalhomemortgage.com/clarksville/";
    psi(u, "mobile", "2026-11-04T03:00:00.000Z", 40);
    psi(u, "mobile", "2026-11-04T03:00:00.000Z", 41); // same timestamp, inserted later
    psi(u, "mobile", "2026-11-04T03:05:00.000Z", 0, "error");
    const r = g.latestPsiPerKey(admin, projectId).find((x) => x.url === u)!;
    expect(r.status).toBe("ok");
    expect(r.result!.scores.performance).toBe(41);
  });

  it("shows the failure when a URL has never succeeded, and checks project access", () => {
    const u = "https://capitalhomemortgage.com/broken/";
    psi(u, "desktop", "2026-11-04T04:00:00.000Z", 0, "error");
    expect(g.latestPsiPerKey(admin, projectId).find((x) => x.url === u)?.status).toBe("error");
    expect(() => g.latestPsiPerKey(outsider, projectId)).toThrow(perms.ForbiddenError);
  });
});

// ---- BUG-01 / BUG-02: Search Console error classification and one shared status ----
const gsc = await import("../server/google/gsc");
const config = await import("../server/google/config");
const { encryptSecret } = await import("../server/settings");
const { searchConsoleStatus } = await import("../server/google/gsc-status");

// Google's real response shape for an API that is disabled in the Cloud project (403 + SERVICE_DISABLED).
const SERVICE_DISABLED = {
  error: {
    code: 403, status: "PERMISSION_DENIED",
    message: "Google Search Console API has not been used in project 154245030857 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=154245030857 then retry.",
    errors: [{ reason: "accessNotConfigured", domain: "usageLimits" }],
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com",
      metadata: { consumer: "projects/154245030857", service: "searchconsole.googleapis.com", activationUrl: "https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=154245030857" } }],
  },
};
const PROPERTY_DENIED = { error: { code: 403, status: "PERMISSION_DENIED", message: "User does not have sufficient permission for site 'sc-domain:capitalhomemortgage.com'.", errors: [{ reason: "forbidden" }] } };

describe("BUG-01: Google error classification", () => {
  it("tells a disabled API apart from a property permission problem", () => {
    const d = gsc.classifyGoogleError(403, SERVICE_DISABLED);
    expect(d.kind).toBe("api-disabled");
    expect(d.projectNumber).toBe("154245030857");
    expect(d.activationUrl).toContain("searchconsole.googleapis.com");
    expect(d.message).toMatch(/turned off in Google Cloud/i);
    expect(d.message).not.toMatch(/permission/i);
    const p = gsc.classifyGoogleError(403, PROPERTY_DENIED);
    expect(p.kind).toBe("permission");
    expect(p.message).toMatch(/doesn't have access/i);
  });

  it("maps expired sign-in, quota, temporary and unknown failures", () => {
    expect(gsc.classifyGoogleError(401, { error: { message: "Invalid Credentials" } }).kind).toBe("auth");
    expect(gsc.classifyGoogleError(429, {}).kind).toBe("quota");
    expect(gsc.classifyGoogleError(403, { error: { errors: [{ reason: "rateLimitExceeded" }], message: "Rate Limit Exceeded" } }).kind).toBe("quota");
    expect(gsc.classifyGoogleError(503, {}).kind).toBe("transient");
    expect(gsc.classifyGoogleError(400, { error: { message: "bad" } }).kind).toBe("other");
  });

  it("classifies network failures and keeps Google's raw text only as technical detail", async () => {
    await expect(gsc.listSites("t", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch)).rejects.toMatchObject({ kind: "network" });
    await expect(gsc.listSites("t", (async () => new Response(JSON.stringify(SERVICE_DISABLED), { status: 403 })) as unknown as typeof fetch))
      .rejects.toMatchObject({ kind: "api-disabled", technical: expect.stringContaining("has not been used in project") });
  });
});

describe("BUG-02: one Search Console status for every screen", () => {
  let respond: (url: string) => Response;
  let connectionId = "";
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

  beforeAll(() => {
    g.setGoogleFetch((async (url: string | URL | Request) => respond(String(url))) as typeof fetch);
  });

  it("walks through not configured → client configured → connected → API error → no property → ready", async () => {
    expect(searchConsoleStatus(admin, projectId).state).toBe("not-configured");

    config.saveGoogleCredentials({ oauthClientId: "123.apps.googleusercontent.com", oauthClientSecret: "test-secret" });
    expect(searchConsoleStatus(admin, projectId)).toMatchObject({ state: "client-configured", action: { href: expect.stringContaining("/google/connections") } });

    connectionId = newId();
    run(`INSERT INTO google_connections (id, user_id, scopes, refresh_token_enc, created_at) VALUES (?, ?, 'webmasters.readonly', ?, ?)`,
      connectionId, admin.id, encryptSecret("refresh"), new Date().toISOString());
    expect(searchConsoleStatus(admin, projectId).state).toBe("connected"); // connected, not yet checked

    // Google says the API is disabled: the check is remembered and every screen shows the same thing.
    respond = (url) => url.includes("oauth2") ? json({ access_token: "a", expires_in: 3600 }) : json(SERVICE_DISABLED, 403);
    await expect(g.testSearchConsole(admin, connectionId, projectId)).resolves.toMatchObject({ ok: false, kind: "api-disabled" });
    const s = searchConsoleStatus(admin, projectId);
    expect(s.state).toBe("api-error");
    expect(s.label).toMatch(/Search Console API not enabled/);
    expect(s.label).not.toMatch(/permission/i);
    expect(s.technical).toContain("154245030857"); // admin only
    expect(searchConsoleStatus(outsiderInProject(), projectId).technical).toBeUndefined();

    // Retry after the API is enabled: success clears the error; no matching property yet.
    respond = (url) => url.includes("oauth2") ? json({ access_token: "a", expires_in: 3600 }) : json({ siteEntry: [{ siteUrl: "sc-domain:other.com", permissionLevel: "siteOwner" }] });
    await expect(g.testSearchConsole(admin, connectionId, projectId)).resolves.toMatchObject({ ok: true, properties: 0 });
    expect(searchConsoleStatus(admin, projectId).state).toBe("no-property");

    run("UPDATE project_google SET connection_id = ?, gsc_property = 'sc-domain:capitalhomemortgage.com' WHERE project_id = ?", connectionId, projectId);
    expect(searchConsoleStatus(admin, projectId)).toMatchObject({ state: "ready", label: expect.stringContaining("sc-domain:capitalhomemortgage.com") });
  });
});

let qaMember: User | undefined;
function outsiderInProject() {
  // A non-admin project member sees the same state but never the technical provider details.
  if (!qaMember) {
    qaMember = auth.createUser({ email: "qa@example.com", name: "QA", password: "correct horse battery", role: "qa" });
    projects.addMember(admin, projectId, qaMember.id);
  }
  return qaMember;
}
