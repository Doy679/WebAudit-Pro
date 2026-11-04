// CHM PageSpeed state targets (handoff 2026-11-04, required tests 1–20). Isolated database; Google is mocked and
// every outbound call is recorded, so the suite proves no request leaves the machine.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../server/auth";

const dir = mkdtempSync(join(tmpdir(), "webaudit-targets-"));
process.env.WEBAUDIT_DATA_DIR = dir;
process.env.WEBAUDIT_SECRET = "test-secret-test-secret-test-secret-1234";

const { closeDb, getDb, run, get, all, newId } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const settings = await import("../server/settings");
const g = await import("../server/google/service");
const runs = await import("../server/runs");
const rules = await import("../server/google/target-rules");
const seed = await import("../server/google/target-seed");
const targets = await import("../server/google/targets");

const CSV = readFileSync(join(process.cwd(), "config/pagespeed-targets/capitalhomemortgage.com.csv"), "utf8");
const API_KEY = `AIza${"T".repeat(35)}`; // synthetic, documented shape
const OLD_URLS = ["/brian-wheeler/", "/centennial-homes/", "/fresh-start-home-mortgages/", "/gbg-team/", "/clarksville/"].map((p) => `https://capitalhomemortgage.com${p}`);

let admin: User, qa: User;
let chm: string, rrmh: string;
const calls: string[] = [];

const tableHash = (table: string) => createHash("sha256").update(JSON.stringify(all(`SELECT * FROM ${table} ORDER BY rowid`))).digest("hex");
const HISTORY = ["audit_runs", "run_pages", "issues", "issue_events", "exports", "approval_packages", "approval_items", "client_decisions", "psi_results", "structured_data", "gsc_data"];
const historyHash = () => Object.fromEntries(HISTORY.map((t) => [t, tableHash(t)]));
const taskCount = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM google_tasks")!.n;
const setKey = (v: string) => settings.setSetting("google.apiKey", settings.encryptSecret(v));

let before: Record<string, string>;
let psiRowsBefore: number;

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  qa = auth.createUser({ email: "qa@example.com", name: "QA", password: "correct horse battery", role: "qa" });
  chm = projects.createProject(admin, { name: "Capital Home Mortgage", baseUrl: "https://capitalhomemortgage.com/", authorizationConfirmed: true, authorizationNote: "pilot" }).id;
  rrmh = projects.createProject(admin, { name: "RedRiverModularHomes", baseUrl: "https://redrivermodularhomes.com/", authorizationConfirmed: true, authorizationNote: "pilot" }).id;
  projects.addMember(admin, chm, qa.id);
  g.setGoogleFetch((async (url: string | URL | Request) => { calls.push(String(url)); throw new Error("no live Google calls in tests"); }) as typeof fetch);
  setKey(API_KEY);

  // Historical results for the old (now unmonitored) URLs and one audit with a finding: must never change.
  const t = new Date(Date.now() - 5 * 3_600_000).toISOString();
  for (const url of OLD_URLS) for (const s of ["mobile", "desktop"]) {
    run(`INSERT INTO psi_results (id, project_id, url, strategy, status, fetched_at, analysis_ts, result_json) VALUES (?, ?, ?, ?, 'ok', ?, ?, ?)`,
      newId(), chm, url, s, t, t, JSON.stringify({ scores: { performance: 70 }, lab: {}, field: null }));
  }
  const runId = newId();
  run("INSERT INTO audit_runs (id, project_id, status, start_url, settings_json, created_by, created_at) VALUES (?, ?, 'completed', ?, '{}', ?, ?)",
    runId, chm, "https://capitalhomemortgage.com/", admin.id, t);
  psiRowsBefore = get<{ n: number }>("SELECT COUNT(*) AS n FROM psi_results")!.n;

  seed.seedTargetsInto(getDb(), chm, rules.inventoryFromCsv(CSV));
  before = historyHash();
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

const byLabel = (label: string) => targets.listTargets(admin, chm).find((t) => t.label === label)!;

describe("seed: homepage + 47 eligible states selected, 4 licensing exclusions kept", () => {
  it("1. the homepage is included and selected", () => {
    const home = byLabel("Homepage");
    expect(home).toMatchObject({ url: "https://capitalhomemortgage.com/", group: "homepage", selected: true, licensing_status: "eligible", verification_status: "verified" });
  });

  it("2. all 47 eligible state/DC pages are present, verified and selected", () => {
    const states = targets.listTargets(admin, chm).filter((t) => t.group === "state" && t.licensing_status === "eligible");
    expect(states).toHaveLength(47);
    expect(states.every((t) => t.selected && t.verification_status === "verified" && t.url)).toBe(true);
    expect(states.find((t) => t.label === "District of Columbia")?.state_code).toBe("DC");
  });

  it("3–6. Massachusetts, Vermont and Virginia (License Pending) and New York (Not Licensed, no page) are excluded", () => {
    for (const s of ["Massachusetts", "Vermont", "Virginia"]) expect(byLabel(s)).toMatchObject({ licensing_status: "license_pending", selected: false });
    expect(byLabel("New York")).toMatchObject({ licensing_status: "not_licensed", selected: false, url: null, verification_status: "no_landing_page" });
    const all52 = targets.listTargets(admin, chm);
    expect(all52).toHaveLength(52);
    expect(all52.filter((t) => t.selected)).toHaveLength(48);
    expect(all52.filter((t) => t.verification_status === "needs_url_review")).toHaveLength(0);
  });

  it("7. the outdated profile/team pages and /clarksville/ are not selected (not targets at all)", () => {
    const urls = targets.listTargets(admin, chm).filter((t) => t.selected).map((t) => t.url);
    for (const u of OLD_URLS) expect(urls).not.toContain(u);
  });

  it("9. URLs equal the CSV exactly (strings, trailing slash, order)", () => {
    const csv = rules.parseCsv(CSV).slice(1);
    const list = targets.listTargets(admin, chm);
    expect(list.map((t) => t.url ?? "")).toEqual(csv.map((r) => r[3]));
    expect(list.map((t) => t.sort_order)).toEqual(csv.map((r) => Number(r[0])));
  });

  it("re-seeding is idempotent and never overwrites later edits; other projects get nothing", () => {
    targets.saveTargetSelection(admin, chm, targets.listTargets(admin, chm).filter((t) => t.selected && t.label !== "Texas").map((t) => t.id));
    expect(seed.seedTargetsInto(getDb(), chm, rules.inventoryFromCsv(CSV)).inserted).toBe(0);
    expect(targets.listTargets(admin, chm)).toHaveLength(52);
    expect(byLabel("Texas").selected).toBe(false);
    seed.seedKnownTargets(getDb()); // keyed on the real CHM project id, which doesn't exist here
    expect(targets.listTargets(admin, rrmh)).toHaveLength(0);
  });
});

describe("selection rules and persistence", () => {
  it("runnable() needs selected + URL + eligible + verified", () => {
    const base = { selected: true, url: "https://x.test/", licensing_status: "eligible", verification_status: "verified" } as const;
    expect(rules.isRunnable(base)).toBe(true);
    expect(rules.isRunnable({ ...base, selected: false })).toBe(false);
    expect(rules.isRunnable({ ...base, url: null })).toBe(false);
    expect(rules.isRunnable({ ...base, licensing_status: "license_pending" })).toBe(false);
    expect(rules.isRunnable({ ...base, verification_status: "needs_url_review" })).toBe(false);
  });

  it("10. excluded, unverified or URL-less targets can't be saved or enter a batch, even if sent or forced", () => {
    const reviewId = newId();
    run(`INSERT INTO pagespeed_targets (id, project_id, url, label, "group", licensing_status, verification_status, selected, sort_order, created_at, updated_at)
         VALUES (?, ?, 'https://capitalhomemortgage.com/review-me/', 'Review me', 'custom', 'eligible', 'needs_url_review', 0, 99, ?, ?)`, reviewId, chm, new Date().toISOString(), new Date().toISOString());
    for (const id of [byLabel("New York").id, byLabel("Massachusetts").id, reviewId]) {
      expect(() => targets.saveTargetSelection(admin, chm, [byLabel("Homepage").id, id])).toThrow(/can't be selected/i);
    }
    // Forced into the database anyway: still never planned.
    run("UPDATE pagespeed_targets SET selected = 1 WHERE id IN (?, ?, ?)", byLabel("New York").id, byLabel("Massachusetts").id, reviewId);
    const plan = targets.planTargetRun(admin, chm, { devices: ["mobile"], skipCache: false });
    expect(plan.urls).not.toContain("https://capitalhomemortgage.com/massachusetts/");
    expect(plan.urls).not.toContain("https://capitalhomemortgage.com/review-me/");
    run("UPDATE pagespeed_targets SET selected = 0 WHERE id IN (?, ?, ?)", byLabel("New York").id, byLabel("Massachusetts").id, reviewId);
    run("DELETE FROM pagespeed_targets WHERE id = ?", reviewId);
  });

  it("11. the saved selection survives a reload and a server restart", () => {
    const ids = targets.listTargets(admin, chm).filter((t) => t.licensing_status === "eligible" && t.label !== "Ohio").map((t) => t.id);
    targets.saveTargetSelection(admin, chm, ids);
    closeDb(); // like a server restart: the next call reopens the database
    expect(byLabel("Ohio").selected).toBe(false);
    expect(byLabel("Texas").selected).toBe(true);
    expect(targets.listTargets(admin, chm).filter((t) => t.selected)).toHaveLength(47);
    targets.saveTargetSelection(admin, chm, targets.listTargets(admin, chm).filter((t) => t.licensing_status === "eligible").map((t) => t.id));
    expect(targets.listTargets(admin, chm).filter((t) => t.selected)).toHaveLength(48);
  });

  it("12. finishing an unrelated audit doesn't change the targets", () => {
    const h = tableHash("pagespeed_targets");
    const runId = newId();
    run("INSERT INTO audit_runs (id, project_id, status, start_url, settings_json, created_by, created_at) VALUES (?, ?, 'running', ?, '{}', ?, ?)",
      runId, chm, "https://capitalhomemortgage.com/", admin.id, new Date().toISOString());
    runs.importResults(runId, [], [{ url: "https://capitalhomemortgage.com/gbg-team/", ok: true, status: 200 }]);
    runs.finishRun(runId, "completed");
    expect(tableHash("pagespeed_targets")).toBe(h);
    before = historyHash(); // this test's own audit is new history; later tests must not change anything
  });

  it("licensing status is admin-only; making a state eligible lets it be selected, making it pending unselects it", () => {
    const ma = byLabel("Massachusetts");
    expect(() => targets.setLicensingStatus(qa, chm, ma.id, "eligible")).toThrow();
    targets.setLicensingStatus(admin, chm, ma.id, "eligible");
    targets.saveTargetSelection(admin, chm, [...targets.listTargets(admin, chm).filter((t) => t.selected).map((t) => t.id), ma.id]);
    expect(byLabel("Massachusetts").selected).toBe(true);
    targets.setLicensingStatus(admin, chm, ma.id, "license_pending");
    expect(byLabel("Massachusetts")).toMatchObject({ selected: false, licensing_status: "license_pending" });
    expect(() => targets.setLicensingStatus(admin, chm, byLabel("New York").id, "eligible")).toThrow(/no landing page/i);
  });
});

describe("batching and the run plan (server-side)", () => {
  it("13. every batch has at most 10 URLs: 48 → 10/10/10/10/8; a lower project limit wins", () => {
    const plan = targets.planTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: true });
    expect(plan.urls).toHaveLength(48);
    expect(plan.batches.map((b) => b.length)).toEqual([10, 10, 10, 10, 8]);
    expect(rules.chunk(Array.from({ length: 48 }, (_, i) => i), rules.batchSize(5)).map((b) => b.length)).toEqual(Array(9).fill(5).concat(3));
    expect(rules.batchSize(50)).toBe(10);
  });

  it("14. requests = URLs × devices (96 for both, 48 for one)", () => {
    expect(targets.planTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: true }).totalRequests).toBe(96);
    expect(targets.planTargetRun(admin, chm, { devices: ["mobile"], skipCache: true }).totalRequests).toBe(48);
    expect(rules.summary(48, 2, 10)).toBe("48 URLs selected · Mobile ✓ Desktop ✓ · 96 requests in 5 batches");
  });

  it("16. no PageSpeed job is created by viewing, planning, saving or changing the selection", () => {
    const n = taskCount();
    targets.listTargets(admin, chm);
    targets.planTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: false });
    targets.saveTargetSelection(admin, chm, targets.listTargets(admin, chm).filter((t) => t.selected).map((t) => t.id));
    targets.monitoredResults(admin, chm);
    expect(taskCount()).toBe(n);
  });

  it("a run needs an explicit confirmation that restates the current numbers", () => {
    expect(() => targets.startTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: true, confirmed: false, expectedRequests: 96 })).toThrow(/confirm/i);
    expect(() => targets.startTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: true, confirmed: true, expectedRequests: 90 })).toThrow(/changed/i);
    expect(taskCount()).toBe(0);
  });

  it("15. cached results under 6 h are counted and reused; the dedupe key prevents duplicate jobs; batches respect the limit", () => {
    const fresh = new Date(Date.now() - 3_600_000).toISOString();
    for (const u of ["texas", "ohio", "utah"]) {
      run(`INSERT INTO psi_results (id, project_id, url, strategy, status, fetched_at, result_json) VALUES (?, ?, ?, 'mobile', 'ok', ?, '{}')`, newId(), chm, `https://capitalhomemortgage.com/${u}/`, fresh);
    }
    before = historyHash();
    const plan = targets.planTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: false });
    expect(plan).toMatchObject({ totalRequests: 96, cacheHits: 3, alreadyQueued: 0, freshRequests: 93 });
    expect(targets.planTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: true }).cacheHits).toBe(0);

    const r = targets.startTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: false, confirmed: true, expectedRequests: 96 });
    expect(r).toMatchObject({ batches: 5, queued: 93, recentlyMeasured: 3, alreadyQueued: 0 });
    expect(taskCount()).toBe(93);
    // Batches are queued separately, each within the project limit, and tagged for progress.
    const perBatch = all<{ b: number; n: number }>("SELECT json_extract(payload_json, '$.batch') AS b, COUNT(DISTINCT json_extract(payload_json, '$.url')) AS n FROM google_tasks GROUP BY b ORDER BY b");
    expect(perBatch.map((x) => x.n)).toEqual([10, 10, 10, 10, 8]);

    const again = targets.planTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: false });
    expect(again.alreadyQueued).toBe(93);
    expect(() => targets.startTargetRun(admin, chm, { devices: ["mobile", "desktop"], skipCache: false, confirmed: true, expectedRequests: 96 })).toThrow(/already running|in progress/i);
    expect(taskCount()).toBe(93);

    const progress = targets.targetRunProgress(admin, chm)!;
    expect(progress.batches).toHaveLength(5);
    expect(progress.batches[0]).toMatchObject({ number: 1, queued: 20 });
    expect(progress.items.filter((i) => i.state === "cached")).toHaveLength(3);
    expect(calls).toHaveLength(0); // queued only: nothing was sent to Google
  });

  it("17. an invalid or rejected key blocks the run: the plan says so and the server refuses", () => {
    run("DELETE FROM google_tasks");
    setKey(`GOCSPX-${"s".repeat(28)}`);
    let plan = targets.planTargetRun(admin, chm, { devices: ["mobile"], skipCache: false });
    expect(plan.blocked).toMatch(/isn't a Google API key/i);
    expect(() => targets.startTargetRun(admin, chm, { devices: ["mobile"], skipCache: false, confirmed: true, expectedRequests: 48 })).toThrow(/isn't a Google API key/i);

    setKey(API_KEY);
    run("INSERT INTO psi_results (id, project_id, url, strategy, status, error, error_kind, fetched_at) VALUES (?, ?, ?, 'mobile', 'error', 'rejected', 'key-rejected', ?)",
      newId(), chm, "https://capitalhomemortgage.com/", new Date().toISOString());
    plan = targets.planTargetRun(admin, chm, { devices: ["mobile"], skipCache: false });
    expect(plan.blocked).toMatch(/rejected/i);
    expect(() => targets.startTargetRun(admin, chm, { devices: ["mobile"], skipCache: false, confirmed: true, expectedRequests: 48 })).toThrow(/rejected/i);
    expect(taskCount()).toBe(0);
    run("DELETE FROM psi_results WHERE error_kind = 'key-rejected'");
    before = historyHash();
  });

  it("QA members can't save the target selection; only project editors can", () => {
    expect(() => targets.saveTargetSelection(qa, chm, [byLabel("Homepage").id])).toThrow();
  });
});

describe("results and other projects", () => {
  it("monitored results show one row per selected target; old URLs are listed as historical/unmonitored, unchanged", () => {
    const m = targets.monitoredResults(admin, chm);
    expect(m.monitored).toHaveLength(48);
    expect(m.monitored.find((r) => r.url === "https://capitalhomemortgage.com/alabama/")).toMatchObject({ mobile: null, desktop: null });
    expect(m.monitored.find((r) => r.url === "https://capitalhomemortgage.com/texas/")?.mobile?.status).toBe("ok");
    const hist = m.unmonitored.map((r) => r.url);
    for (const u of OLD_URLS) expect(hist).toContain(u);
  });

  it("18–19. RedRiverModularHomes keeps today's behaviour and can't see or use CHM targets", () => {
    expect(targets.listTargets(admin, rrmh)).toEqual([]);
    expect(targets.hasTargets(rrmh)).toBe(false);
    expect(targets.hasTargets(chm)).toBe(true);
    expect(() => targets.saveTargetSelection(admin, rrmh, [byLabel("Homepage").id])).toThrow(/can't be selected/i);
    expect(() => targets.planTargetRun(admin, rrmh, { devices: ["mobile"], skipCache: false })).toThrow(/no monitoring targets/i);
  });

  it("8 + 20. historical PageSpeed rows, audits, findings, reports and approvals are byte-for-byte unchanged; no Google calls", () => {
    expect(historyHash()).toEqual(before);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM psi_results WHERE url IN (?, ?, ?, ?, ?)", ...OLD_URLS)!.n).toBe(10);
    expect(psiRowsBefore).toBe(10);
    expect(calls).toHaveLength(0);
  });
});
