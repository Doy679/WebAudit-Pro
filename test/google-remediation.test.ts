// Google integration remediation (QA 2026-11-04, GQA-01…08). Isolated database; Google is mocked, no live traffic.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../server/auth";
import { psiSample } from "./fixtures/google/psi-sample";

const dir = mkdtempSync(join(tmpdir(), "webaudit-gqa-"));
process.env.WEBAUDIT_DATA_DIR = dir;
process.env.WEBAUDIT_SECRET = "test-secret-test-secret-test-secret-1234";

const { closeDb, run, get, all, newId } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const config = await import("../server/google/config");
const settings = await import("../server/settings");
const creds = await import("../server/google/credentials");
const g = await import("../server/google/service");
const psiMod = await import("../server/google/psi");
const gscMod = await import("../server/google/gsc");
const { pageSpeedHealth } = await import("../server/google/health-status");
const { searchConsoleStatus } = await import("../server/google/gsc-status");
const { setupChecklist } = await import("../server/google/setup");

// Synthetic credentials with Google's documented shapes. None of them is real.
const API_KEY = `AIza${"T".repeat(35)}`;
const API_KEY_2 = `AIza${"R".repeat(35)}`;
const OAUTH_SECRET = `GOCSPX-${"s".repeat(28)}`; // 35 characters, like the value found in the key field
const CLIENT_ID = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";

let admin: User, qa: User;
let projectId: string;
let respond: (url: string) => Response;
const calls: string[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const keyRejected = () => json({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, 400);

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin Person", password: "correct horse battery", role: "admin" });
  qa = auth.createUser({ email: "qa@example.com", name: "QA", password: "correct horse battery", role: "qa" });
  projectId = projects.createProject(admin, { name: "CHM", baseUrl: "https://capitalhomemortgage.com", authorizationConfirmed: true, authorizationNote: "pilot" }).id;
  projects.addMember(admin, projectId, qa.id);
  g.setGoogleFetch((async (url: string | URL | Request) => { calls.push(String(url)); return respond(String(url)); }) as typeof fetch);
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

/** Stores a value as the saved PageSpeed key without validation, the way older versions did. */
const storeRawKey = async (value: string) => {
  const { encryptSecret, setSetting } = await import("../server/settings");
  setSetting("google.apiKey", encryptSecret(value));
};

describe("G1-1: credential formats are checked before saving", () => {
  it("1. accepts a conventional Google API key", () => {
    expect(creds.checkCredential("apiKey", API_KEY)).toEqual({ ok: true });
    expect(creds.isGoogleApiKey(API_KEY)).toBe(true);
  });

  it("2. rejects an OAuth client secret in the API key field, without echoing it", () => {
    const r = creds.checkCredential("apiKey", OAUTH_SECRET);
    expect(r).toMatchObject({ ok: false, kind: "oauth-secret" });
    expect(!r.ok && r.message).toMatch(/looks like an OAuth client secret, not a Google API key/i);
    expect(!r.ok && r.message).toMatch(/APIs & Services → Credentials → API keys/);
    expect(JSON.stringify(r)).not.toContain(OAUTH_SECRET);
    expect(() => config.saveGoogleCredentials({ apiKey: OAUTH_SECRET }, admin)).toThrow(/OAuth client secret/);
    expect(config.googleStatus().apiKeyConfigured).toBe(false); // nothing saved
  });

  it("3. rejects an OAuth client ID in the API key field", () => {
    expect(creds.checkCredential("apiKey", CLIENT_ID)).toMatchObject({ ok: false, kind: "oauth-client-id" });
    expect(() => config.saveGoogleCredentials({ apiKey: CLIENT_ID }, admin)).toThrow(/OAuth client ID/);
  });

  it("rejects malformed keys, keys with spaces, and an API key pasted as the OAuth secret", () => {
    expect(creds.checkCredential("apiKey", "AIzaTOO-SHORT")).toMatchObject({ ok: false, kind: "malformed" });
    expect(creds.checkCredential("apiKey", `${API_KEY.slice(0, 20)} ${API_KEY.slice(20)}`)).toMatchObject({ ok: false, kind: "malformed" });
    expect(creds.checkCredential("apiKey", "")).toMatchObject({ ok: false, kind: "empty" });
    expect(creds.checkCredential("oauthClientSecret", API_KEY)).toMatchObject({ ok: false, kind: "api-key" });
    expect(creds.checkCredential("oauthClientSecret", CLIENT_ID)).toMatchObject({ ok: false, kind: "oauth-client-id" });
    expect(creds.checkCredential("oauthClientSecret", OAUTH_SECRET)).toEqual({ ok: true });
    expect(creds.checkCredential("oauthClientId", OAUTH_SECRET)).toMatchObject({ ok: false, kind: "oauth-secret" });
    expect(creds.checkCredential("oauthClientId", CLIENT_ID)).toEqual({ ok: true });
  });

  it("an invalid field in one save leaves every stored value unchanged", () => {
    config.saveGoogleCredentials({ apiKey: API_KEY, oauthClientId: CLIENT_ID, oauthClientSecret: OAUTH_SECRET }, admin);
    expect(() => config.saveGoogleCredentials({ apiKey: API_KEY_2, oauthClientSecret: API_KEY_2 }, admin)).toThrow(/API key/);
    expect(config.googleConfig().apiKey).toBe(API_KEY);
    expect(config.googleConfig().oauthClientSecret).toBe(OAUTH_SECRET);
  });
});

describe("G1-1/G1-2: a malformed saved credential never reaches Google and has its own health state", () => {
  it("4. runPsi with a non-key value makes zero requests", async () => {
    let n = 0;
    const fetchImpl = (async () => { n++; return json(psiSample()); }) as unknown as typeof fetch;
    await expect(psiMod.runPsi("https://example.com/", "mobile", { apiKey: OAUTH_SECRET, fetchImpl, retries: 0 })).rejects.toMatchObject({ kind: "invalid-format" });
    expect(n).toBe(0);
  });

  it("5. an existing malformed credential shows invalid-format, distinct from 'rejected by Google'", async () => {
    await storeRawKey(OAUTH_SECRET);
    const h = pageSpeedHealth(admin);
    expect(h.state).toBe("invalid-format");
    expect(h.label).toMatch(/saved PageSpeed credential isn't a Google API key/i);
    expect(h.detail).toMatch(/appears to be an OAuth client secret/i);
    expect(JSON.stringify(h)).not.toContain(OAUTH_SECRET);

    // A queued request is refused locally: stored as an error row, no Google call.
    const before = calls.length;
    const id = g.queuePsi(admin, projectId, { urls: ["https://capitalhomemortgage.com/"], strategies: ["mobile"], force: true }).queued[0];
    expect(await g.processGoogleTask(id)).toBe("failed");
    expect(calls.length).toBe(before);
    expect(get<{ error_kind: string }>("SELECT error_kind FROM psi_results ORDER BY rowid DESC LIMIT 1")!.error_kind).toBe("invalid-format");

    // A syntactically valid key is not proof Google accepts it: still "untested" until a live result exists.
    await storeRawKey(API_KEY);
    run("INSERT INTO app_settings (key, value) VALUES ('google.apiKeySavedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", new Date().toISOString());
    expect(pageSpeedHealth(admin).state).toBe("untested");
  });
});

describe("G1-3: secrets are redacted everywhere", () => {
  const token = `ya29.${"a".repeat(40)}`;
  const refresh = `1//0${"b".repeat(40)}`;
  const leaky = `bad ${API_KEY} ${OAUTH_SECRET} ${token} ${refresh} https://x.test/?key=abc123&access_token=zzz999&y=1`;

  it("6. redactSecrets removes API keys, client secrets, access/refresh tokens and secret URL parameters", () => {
    const out = creds.redactSecrets(leaky);
    for (const s of [API_KEY, OAUTH_SECRET, token, refresh, "abc123", "zzz999"]) expect(out).not.toContain(s);
    expect(out).toContain("y=1");
  });

  it("PageSpeed and Search Console error details never contain secrets", () => {
    const psi = psiMod.classifyPsiError(403, { error: { message: leaky } });
    const gsc = gscMod.classifyGoogleError(403, { error: { message: leaky } });
    for (const info of [psi, gsc]) for (const s of [API_KEY, OAUTH_SECRET, token, refresh, "zzz999"]) {
      expect(info.technical).not.toContain(s);
      expect(info.message).not.toContain(s);
    }
  });

  it("stored task errors and result rows are redacted", async () => {
    await storeRawKey(API_KEY);
    respond = () => { throw new TypeError(`connect failed for ...?key=${API_KEY}`); };
    const id = g.queuePsi(admin, projectId, { urls: ["https://capitalhomemortgage.com/leak/"], strategies: ["mobile"], force: true }).queued[0];
    await g.processGoogleTask(id, { retries: 0 });
    const dump = JSON.stringify(all("SELECT * FROM google_tasks")) + JSON.stringify(all("SELECT error, error_detail FROM psi_results"));
    expect(dump).not.toContain(API_KEY);
  });
});

describe("G1-4: Test PageSpeed key runs once", () => {
  it("7. three rapid submissions produce one Google request; later ones get the result and the next allowed time", async () => {
    await storeRawKey(API_KEY);
    respond = () => keyRejected();
    const before = calls.length;
    const results = await Promise.all([1, 2, 3].map(() => g.testPageSpeedKey(admin, projectId, true)));
    expect(calls.length - before).toBe(1);
    expect(results.filter((r) => r.kind === "key-rejected" && !r.reused)).toHaveLength(1);
    expect(results.filter((r) => r.reused)).toHaveLength(2);

    const again = await g.testPageSpeedKey(admin, projectId, true); // within the cooldown
    expect(again).toMatchObject({ ok: false, reused: true });
    expect(calls.length - before).toBe(1);

    const state = g.pageSpeedTestState();
    expect(state.running).toBe(false);
    expect(state.last).toMatchObject({ ok: false, kind: "key-rejected" });
    expect(Date.parse(state.nextAllowedAt!) - Date.parse(state.last!.at)).toBe(g.PSI_TEST_COOLDOWN_MS);
  });

  it("after the cooldown a new test is allowed; a malformed key is refused without a request", async () => {
    const s = JSON.parse(get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'google.psiTest'")!.value);
    s.last.at = new Date(Date.now() - 61_000).toISOString();
    run("UPDATE app_settings SET value = ? WHERE key = 'google.psiTest'", JSON.stringify(s));
    respond = () => json(psiSample());
    const before = calls.length;
    const after = await g.testPageSpeedKey(admin, projectId, true);
    expect(after).toMatchObject({ ok: true });
    expect(calls.length - before).toBe(1);

    await storeRawKey(OAUTH_SECRET);
    const s2 = JSON.parse(get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'google.psiTest'")!.value);
    s2.last.at = new Date(Date.now() - 61_000).toISOString();
    run("UPDATE app_settings SET value = ? WHERE key = 'google.psiTest'", JSON.stringify(s2));
    expect(await g.testPageSpeedKey(admin, projectId, true)).toMatchObject({ ok: false, kind: "invalid-format" });
    expect(calls.length - before).toBe(1);
  });

  it("14. admin-only: QA can't test the key, save credentials history or see technical details", async () => {
    await expect(g.testPageSpeedKey(qa, projectId, true)).rejects.toThrow();
    expect(() => config.credentialHistory(qa)).toThrow();
    expect(pageSpeedHealth(qa).technical).toBeUndefined();
  });
});

describe("G2-1: Search Console status shows when it was checked and when it may be stale", () => {
  let connId: string;
  beforeAll(() => {
    connId = newId();
    const { encryptSecret } = settings;
    run(`INSERT INTO google_connections (id, user_id, scopes, refresh_token_enc, created_at) VALUES (?, ?, 'webmasters.readonly', ?, ?)`, connId, admin.id, encryptSecret("1//refresh"), new Date().toISOString());
  });

  it("8. an old API-disabled check is labelled with its time and a stale hint; a fresh one isn't", () => {
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    run("UPDATE google_connections SET last_error = 'disabled', last_error_kind = 'api-disabled', last_check_at = ?, last_failure_at = ? WHERE id = ?", old, old, connId);
    const s = searchConsoleStatus(admin, projectId);
    expect(s).toMatchObject({ state: "api-error", checkedAt: old, stale: true, lastFailureAt: old, lastSuccessAt: null });
    expect(s.freshness).toMatch(/^Last checked .+\. This status may be out of date\. Retry to check again\.$/);

    const fresh = new Date().toISOString();
    run("UPDATE google_connections SET last_check_at = ?, last_failure_at = ? WHERE id = ?", fresh, fresh, connId);
    const f = searchConsoleStatus(admin, projectId);
    expect(f.stale).toBe(false);
    expect(f.freshness).toMatch(/^Last checked /);
    expect(f.freshness).not.toMatch(/out of date/);
  });

  it("a check from before the timestamps existed falls back to last_check_at for the failure time (no invented success)", () => {
    const old = new Date(Date.now() - 3_600_000).toISOString();
    run("UPDATE google_connections SET last_check_at = ?, last_failure_at = NULL WHERE id = ?", old, connId);
    expect(searchConsoleStatus(admin, projectId)).toMatchObject({ lastFailureAt: old, lastSuccessAt: null });
  });

  it("a successful Retry records the success time and clears the error", async () => {
    respond = () => json({ siteEntry: [{ siteUrl: "sc-domain:capitalhomemortgage.com", permissionLevel: "siteOwner" }] });
    run("UPDATE google_connections SET access_token_enc = ?, access_expires_at = ? WHERE id = ?",
      settings.encryptSecret("ya29.token"), new Date(Date.now() + 3_600_000).toISOString(), connId);
    expect(await g.testSearchConsole(admin, connId, projectId)).toMatchObject({ ok: true, properties: 1 });
    const s = searchConsoleStatus(admin, projectId);
    expect(s.state).toBe("no-property");
    expect(s.lastSuccessAt).toBeTruthy();
    expect(s.stale).toBe(false);
  });
});

describe("G2-2: last successful PageSpeed results show newer failures", () => {
  it("9. a success followed by a failure keeps the success and reports the newer failure", async () => {
    await storeRawKey(API_KEY);
    const url = "https://capitalhomemortgage.com/g22/";
    respond = () => json(psiSample());
    await g.processGoogleTask(g.queuePsi(admin, projectId, { urls: [url], strategies: ["desktop"], force: true }).queued[0]);
    respond = () => keyRejected();
    await g.processGoogleTask(g.queuePsi(admin, projectId, { urls: [url], strategies: ["desktop"], force: true }).queued[0]);
    const row = g.latestPsiPerKey(admin, projectId).find((r) => r.url === url && r.strategy === "desktop")!;
    expect(row.status).toBe("ok");
    expect(row.newerFailure).toMatchObject({ kind: "key-rejected" });
    expect(row.newerFailure!.at > row.fetched_at).toBe(true);
  });
});

describe("G2-3: cache reuses are labelled as such", () => {
  it("10. a cache hit is recorded as 'cached' with Google's original time; a fresh call as 'fresh'", async () => {
    await storeRawKey(API_KEY);
    const url = "https://capitalhomemortgage.com/g23/";
    respond = () => json(psiSample());
    const fresh = g.queuePsi(admin, projectId, { urls: [url], strategies: ["mobile"] }).queued[0];
    await g.processGoogleTask(fresh);
    // Linked to an audit so the cache path runs (the queue skips recently measured URLs without a run).
    const runId = newId();
    run("INSERT INTO audit_runs (id, project_id, status, start_url, settings_json, created_by, created_at) VALUES (?, ?, 'completed', ?, '{}', ?, ?)",
      runId, projectId, url, admin.id, new Date().toISOString());
    const cachedTask = newId();
    run("INSERT INTO google_tasks (id, type, project_id, run_id, payload_json, status, created_by, created_at) VALUES (?, 'psi', ?, ?, ?, 'pending', ?, ?)",
      cachedTask, projectId, runId, JSON.stringify({ url, strategy: "mobile", force: false }), admin.id, new Date().toISOString());
    const before = calls.length;
    await g.processGoogleTask(cachedTask);
    expect(calls.length).toBe(before);
    const tasks = g.googleTasks(admin, projectId, 100);
    const f = tasks.find((t) => t.id === fresh)!;
    const c = tasks.find((t) => t.id === cachedTask)!;
    expect(f.outcome).toBe("fresh");
    expect(c.outcome).toBe("cached");
    expect(c.sourceAt).toBe(get<{ fetched_at: string }>("SELECT fetched_at FROM psi_results WHERE url = ? AND status = 'ok' ORDER BY rowid LIMIT 1", url)!.fetched_at);
  });

  it("older tasks without a stored outcome are derived from the stored results (display only, nothing rewritten)", () => {
    const url = "https://capitalhomemortgage.com/g23/";
    const legacy = newId();
    const t = new Date().toISOString();
    run("INSERT INTO google_tasks (id, type, project_id, payload_json, status, created_by, created_at, started_at, finished_at) VALUES (?, 'psi', ?, ?, 'completed', ?, ?, ?, ?)",
      legacy, projectId, JSON.stringify({ url, strategy: "mobile" }), admin.id, t, t, t);
    const row = g.googleTasks(admin, projectId, 100).find((x) => x.id === legacy)!;
    expect(row.outcome).toBe("cached");
    expect(get<{ outcome: string | null }>("SELECT outcome FROM google_tasks WHERE id = ?", legacy)!.outcome).toBeNull();
  });
});

describe("G2-4: credential change history", () => {
  it("11. records type, action, actor and time, never the value", () => {
    config.saveGoogleCredentials({ apiKey: API_KEY_2 }, admin);
    config.saveGoogleCredentials({ removeApiKey: true }, admin);
    const h = config.credentialHistory(admin);
    expect(h[0]).toMatchObject({ credential: "apiKey", action: "removed", changed_by: "Admin Person" });
    expect(h[1]).toMatchObject({ credential: "apiKey", action: "replaced" });
    expect(h.find((e) => e.credential === "oauthClientSecret")).toMatchObject({ action: "added" });
    const dump = JSON.stringify(all("SELECT * FROM credential_events"));
    for (const s of [API_KEY, API_KEY_2, OAUTH_SECRET]) expect(dump).not.toContain(s);
    expect(config.lastCredentialChange(admin, "apiKey")).toMatchObject({ action: "removed" });
  });
});

describe("G2-5 / G3: recovery links and the setup checklist", () => {
  it("12. links to Google Cloud Credentials for the known project, and to the key field (not the same page)", async () => {
    expect(creds.cloudCredentialsUrl("154245030857")).toBe("https://console.cloud.google.com/apis/credentials?project=154245030857");
    expect(creds.cloudCredentialsUrl()).toBe("https://console.cloud.google.com/apis/credentials");
    await storeRawKey(OAUTH_SECRET);
    const h = pageSpeedHealth(admin);
    expect(h.action?.href).toBe("/google/connections#google-credentials");
    expect(h.cloudAction?.href).toMatch(/^https:\/\/console\.cloud\.google\.com\/apis\/credentials/);
  });

  it("the checklist has five steps with state, why, next action and check times", async () => {
    await storeRawKey(OAUTH_SECRET);
    const steps = setupChecklist(admin, projectId);
    expect(steps.map((s) => s.id)).toEqual(["key-saved", "key-format", "account", "gsc-api", "property"]);
    expect(steps[0].state).toBe("done");
    expect(steps[1]).toMatchObject({ state: "problem" });
    expect(steps[1].status).toMatch(/OAuth client secret/);
    expect(steps[2].state).toBe("done");
    expect(steps[4].state).toBe("todo");
    for (const s of steps as { why: string; title: string }[]) { expect(s.why.length).toBeGreaterThan(10); expect(s.title).toBeTruthy(); }
    expect(JSON.stringify(steps)).not.toContain(OAUTH_SECRET);
  });
});
