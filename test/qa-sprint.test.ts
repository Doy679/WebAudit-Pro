// Regression tests for the 2026-11-04 browser QA findings (BUG-xx / UX-xx in docs/agile/browser_qa_2026-11-04).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../server/auth";

const dir = mkdtempSync(join(tmpdir(), "webaudit-qa-"));
process.env.WEBAUDIT_DATA_DIR = dir;
process.env.WEBAUDIT_SECRET = "test-secret-test-secret-test-secret-1234";

const { closeDb, run, newId, all, get } = await import("../server/db");
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

describe("BUG-04: PageSpeed requests are idempotent and cache reuse doesn't inflate history", () => {
  it("a second submit while the same URL + device is still queued creates no new request", () => {
    config.saveGoogleCredentials({ apiKey: "AIzaTESTKEY" });
    const urls = ["https://capitalhomemortgage.com/", "https://capitalhomemortgage.com/clarksville/"];
    const first = g.queuePsi(admin, projectId, { urls, strategies: ["mobile", "desktop"] });
    expect(first.queued).toHaveLength(4);
    const again = g.queuePsi(admin, projectId, { urls, strategies: ["mobile", "desktop"] });
    expect(again.queued).toHaveLength(0);
    expect(again.alreadyQueued).toBe(4);
    const forced = g.queuePsi(admin, projectId, { urls, strategies: ["mobile"], force: true }); // "skip cache" doesn't bypass the in-flight check either
    expect(forced.queued).toHaveLength(0);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM google_tasks WHERE status = 'pending'")!.n).toBe(4);
  });

  it("reusing a cached result for the same audit link doesn't add a duplicate history row", async () => {
    run("UPDATE google_tasks SET status = 'completed' WHERE status = 'pending'");
    const u = "https://capitalhomemortgage.com/reuse/";
    psi(u, "mobile", new Date().toISOString(), 70);
    const before = all<{ id: string }>("SELECT id FROM psi_results WHERE url = ?", u).length;
    const { queued } = g.queuePsi(admin, projectId, { urls: [u], strategies: ["mobile"] });
    expect(await g.processGoogleTask(queued[0])).toBe("completed");
    expect(all("SELECT id FROM psi_results WHERE url = ?", u)).toHaveLength(before);
  });
});

describe("BUG-14 / BUG-15: report categories and empty reports", () => {
  const runs2 = () => import("../server/runs");
  const exportsMod = () => import("../server/exports");
  let runId = "";
  beforeAll(async () => {
    const r = await runs2();
    runId = r.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" });
    const issue = (code: string, type: string) => ({
      id: code, type, rule: `${type}-rule`, kind: "confirmed", severity: "high", confidence: 0.9, title: code, fingerprint: code.toLowerCase().padEnd(16, "0"),
      location: { url: "https://capitalhomemortgage.com/", pages: ["https://capitalhomemortgage.com/"], viewports: [390] },
      instanceCount: 1, occurrences: [], recommendation: "x", current: "x", proposed: "y", evidence: { screenshots: [], boxes: [], capturedAt: "t" }, review: { status: "pending", notes: "", reviewer: null },
    });
    r.importResults(runId, [issue("P1", "performance"), issue("P2", "performance"), issue("C1", "cwv"), issue("L1", "layout")] as never, []);
    r.finishRun(runId, "completed");
  });

  it("offers every category the audit actually has, including Performance and Core Web Vitals", async () => {
    const { reportCategories, exportPreview } = await exportsMod();
    const cats = reportCategories(admin, runId);
    expect(cats.map((c) => c.value)).toEqual(expect.arrayContaining(["performance", "cwv", "layout"]));
    expect(cats.find((c) => c.value === "performance")).toMatchObject({ label: "Performance", count: 2 });
    expect(exportPreview(admin, runId, { type: "performance" }).total).toBe(2);
  });

  it("refuses to create an empty report on the server", async () => {
    const { createExport } = await exportsMod();
    expect(() => createExport(admin, { runId, format: "pdf", filters: { reviewedOnly: true } })).toThrow(/no findings match/i);
    expect(createExport(admin, { runId, format: "xlsx", filters: { type: "cwv" } })).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("BUG-17 / BUG-18: safe review controls", async () => {
  const issuesMod = await import("../server/issues");
  it("bulk actions need a deliberate choice, a selection, and confirmation above 10 rows", () => {
    expect(() => issuesMod.checkBulkRequest("", 3, false)).toThrow(/choose an action/i);
    expect(() => issuesMod.checkBulkRequest("confirm", 0, false)).toThrow(/select at least one/i);
    expect(() => issuesMod.checkBulkRequest("confirm", 11, false)).toThrow(/11 findings/);
    expect(() => issuesMod.checkBulkRequest("confirm", 11, true)).not.toThrow();
    expect(() => issuesMod.checkBulkRequest("false_positive", 10, false)).not.toThrow();
  });

  it("offers review actions that match the finding's classification", () => {
    const keys = (k: string) => issuesMod.reviewActionsFor(k).map((a) => a.action);
    expect(keys("confirmed")).toEqual(["confirm", "false_positive", "note"]);
    expect(keys("needs-review")).toEqual(["confirm", "false_positive", "note"]);
    expect(keys("recommendation")).toEqual(["approve", "request_revision", "reject", "note"]);
  });
});

describe("BUG-16: health cards open their own filtered list", async () => {
  const { parseIssueSearchParams } = await import("../server/issue-filters");
  const issuesMod = await import("../server/issues");
  it("parses a validated multi-category filter and applies it", () => {
    expect(parseIssueSearchParams({ types: "layout,spacing,BAD!,layout" }).types).toEqual(["layout", "spacing"]);
    const run = get<{ id: string }>("SELECT run_id AS id FROM issues WHERE type = 'performance' LIMIT 1")!.id;
    const rows = issuesMod.listIssues(admin, { runId: run, types: ["performance", "cwv"] }).rows;
    expect(rows.map((r) => r.type).sort()).toEqual(["cwv", "performance", "performance"]);
  });
});

describe("BUG-11 / UX-04: mixed-website lists and quick-filter counts", async () => {
  const { QUICK_FILTERS, parseIssueSearchParams } = await import("../server/issue-filters");
  const issuesMod = await import("../server/issues");
  it("has a Recommendations quick filter and counts every chip with the same query as the list", () => {
    expect(QUICK_FILTERS.map((q) => q.key)).toContain("recommendations");
    const run = get<{ id: string }>("SELECT run_id AS id FROM issues WHERE type = 'performance' LIMIT 1")!.id;
    const counts = issuesMod.quickFilterCounts(admin, { runId: run });
    expect(counts.all).toBe(4);
    expect(counts.high).toBe(issuesMod.listIssues(admin, { ...parseIssueSearchParams({ quick: "high" }), runId: run }).total);
  });
});

describe("BUG-07 / BUG-08 / UX-08: Re-Audit comparisons", async () => {
  const runsMod = await import("../server/runs");
  const { compareProjectRuns } = await import("../server/compare");
  const mk = (code: string, over: Record<string, unknown>) => ({
    id: code, type: "a11y", rule: "axe:aria-valid-attr-value", kind: "confirmed", severity: "high", confidence: 0.9, title: code, fingerprint: code.toLowerCase().padEnd(16, "0"),
    location: { url: "https://capitalhomemortgage.com/", pages: ["https://capitalhomemortgage.com/"], viewports: [390], selector: "#x" },
    instanceCount: 1, occurrences: [], recommendation: "x", current: "x", proposed: "y", evidence: { screenshots: [], boxes: [], capturedAt: "t" }, review: { status: "pending", notes: "", reviewer: null }, ...over,
  });
  let base = "", after = "";
  beforeAll(() => {
    const page = { url: "https://capitalhomemortgage.com/", ok: true, status: 200 };
    base = runsMod.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/", categories: ["a11y"] } as never);
    // Base run fingerprinted before the volatile-id normalisation: the stored fingerprint embeds the per-load id.
    runsMod.importResults(base, [mk("A11Y-0001", { location: { url: page.url, pages: [page.url], viewports: [390], selector: "#sm-17936905811318271-1" }, fingerprint: "oldoldoldoldold1" })] as never, [page]);
    runsMod.finishRun(base, "completed");
    run("UPDATE audit_runs SET created_at = '2026-11-03T07:22:00.000Z' WHERE id = ?", base);
    after = runsMod.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" } as never);
    runsMod.importResults(after, [
      mk("A11Y-0001", { location: { url: page.url, pages: [page.url], viewports: [390], selector: "#sm-17937559783053635-1" } }),
      mk("TYP-0001", { type: "typography", rule: "font-too-small", location: { url: page.url, pages: [page.url], viewports: [390], selector: "p.small" } }),
      mk("PERF-0001", { type: "performance", rule: "psi:lcp", provider: "psi", location: { url: page.url, pages: [page.url], viewports: [] } }),
    ] as never, [page]);
    run("UPDATE issues SET provider = 'psi' WHERE run_id = ? AND code = 'PERF-0001'", after);
    runsMod.finishRun(after, "completed");
  });

  it("matches the same element across audits even when its per-load id changed (no history rewrite)", () => {
    const { rows } = compareProjectRuns(admin, base, after);
    expect(rows.find((r) => r.latestIssue?.code === "A11Y-0001")?.status).toBe("still_present");
    expect(get<{ f: string }>("SELECT fingerprint AS f FROM issues WHERE run_id = ? AND code = 'A11Y-0001'", base)!.f).toBe("oldoldoldoldold1");
  });

  it("puts findings from checks the base audit didn't run in 'Not checked before', not 'New'", () => {
    const { rows, counts } = compareProjectRuns(admin, base, after);
    expect(rows.find((r) => r.latestIssue?.code === "TYP-0001")?.status).toBe("not_checked_before"); // base audit had only a11y
    expect(rows.find((r) => r.latestIssue?.code === "PERF-0001")?.status).toBe("not_checked_before"); // no PageSpeed in base
    expect(counts.new ?? 0).toBe(0);
  });

  it("refuses to compare an audit with itself", () => {
    expect(() => compareProjectRuns(admin, after, after)).toThrow(/two different audits/i);
  });
});

describe("BUG-05: whole-site (origin) real-user data is labelled and not repeated per page", async () => {
  const psiMod = await import("../server/google/psi");
  const { psiSample } = await import("./fixtures/google/psi-sample");
  const poorField = (id: string, extra: Record<string, unknown> = {}) => ({
    id, ...extra, overall_category: "SLOW",
    metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4060, category: "SLOW" }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 60, category: "SLOW" } },
  });
  const sample = (page: string, loading: Record<string, unknown>) => ({ ...psiSample(), id: page, loadingExperience: loading, originLoadingExperience: poorField("https://capitalhomemortgage.com") });

  it("treats PageSpeed's origin fallback as whole-site data", () => {
    const page = "https://capitalhomemortgage.com/brian-wheeler/";
    expect(psiMod.parsePsi(sample(page, poorField("https://capitalhomemortgage.com", { origin_fallback: true })), "mobile").field?.scope).toBe("origin");
    expect(psiMod.parsePsi(sample(page, poorField(page)), "mobile").field?.scope).toBe("url");
  });

  it("creates one whole-site finding per metric and device, whichever page reported it", () => {
    const pages = ["https://capitalhomemortgage.com/", "https://capitalhomemortgage.com/brian-wheeler/", "https://capitalhomemortgage.com/clarksville/"];
    const fps = new Set<string>();
    for (const p of pages) {
      const r = psiMod.parsePsi(sample(p, poorField("https://capitalhomemortgage.com", { origin_fallback: true })), "mobile");
      for (const f of psiMod.psiFindings(r, p).filter((x) => x.type === "cwv")) {
        expect(f.title).toMatch(/whole site/i);
        fps.add(g.providerFingerprint(f));
      }
    }
    expect(fps.size).toBe(2); // LCP + CLS once each, not 6
  });
});

describe("BUG-06: real-user summary per device", async () => {
  const { fieldSummary } = await import("../server/health");
  it("labels the device and the data scope, so a poor desktop value can't hide behind a mobile 'good'", () => {
    const f = (cat: string, scope: "url" | "origin") => ({ source: "psi-crux" as const, scope, metrics: { inp: { p75: 542, unit: "ms" as const, category: cat as never } } });
    expect(fieldSummary(f("good", "url"), "mobile")).toBe("INP good (this page)");
    expect(fieldSummary(f("poor", "origin"), "desktop")).toBe("INP poor (whole site)");
    expect(fieldSummary(null, "desktop")).toBeNull();
  });
});

describe("BUG-13: structured-data page counts", async () => {
  const { websiteHealth } = await import("../server/health");
  it("counts only pages that have at least one item", () => {
    const run = get<{ id: string }>("SELECT run_id AS id FROM issues WHERE type = 'performance' LIMIT 1")!.id;
    const ins = (url: string, items: unknown[]) => run_(`INSERT INTO structured_data (run_id, project_id, url, items_json, errors, warnings, rules_version, checked_at) VALUES (?, ?, ?, ?, 0, 0, 'v', 't')`, run, projectId, url, JSON.stringify(items));
    ins("https://capitalhomemortgage.com/a/", [{ types: ["Article"] }]);
    ins("https://capitalhomemortgage.com/b/", []);
    ins("https://capitalhomemortgage.com/c/", []);
    const sd = websiteHealth(admin, projectId, run).sections.find((s) => s.key === "structured")!;
    expect(sd.metrics.find((m) => m.label === "Pages with structured data")?.value).toBe(1);
    expect(sd.metrics.find((m) => m.label === "Pages checked")?.value).toBe(3);
  });
});
const run_ = run;

describe("BUG-25: implausible line-height measurements", async () => {
  const { typographyChecks } = await import("../src/checks/typography");
  const { el, page, tokens } = await import("./helpers");
  const lineIssues = (lineHeight: number, h: number) =>
    typographyChecks(page({ elements: [el({ selector: "p.x", role: "text", tag: "p", text: "Janice Stowers Mortgage Team", css: { fontSize: 14, lineHeight }, box: { x: 0, y: 0, w: 600, h } })] }), tokens)
      .filter((i) => i.rule === "line-height-tight");

  it("ignores spacer elements too short to show a line of text (the reported 668×1 px paragraph)", () => {
    expect(lineIssues(1.4, 1)).toHaveLength(0);
  });

  it("sends physically implausible ratios to review instead of a confident recommendation", () => {
    const [i] = lineIssues(1.4, 40);
    expect(i).toMatchObject({ kind: "needs-review" });
    expect(i.recommendation).toMatch(/check visually/i);
  });

  it("keeps real cramped text as a recommendation", () => {
    expect(lineIssues(16, 48)[0]).toMatchObject({ kind: "recommendation" }); // 1.14 on 14px text
    expect(lineIssues(22, 66)).toHaveLength(0); // 1.57 is fine
  });
});

describe("BUG-24 / UX-17: audit duration estimate from real history", async () => {
  const runsMod = await import("../server/runs");
  it("uses the median observed seconds per page per screen size, with a range", () => {
    // Two finished audits like the real ones: CHM 20 pages x 5 sizes in 16 m 28 s; RRMH 80 x 5 in 54 m 33 s.
    const mkRun = (pages: number, seconds: number) => {
      const id = runsMod.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/", viewports: [320, 390, 768, 1024, 1440] } as never);
      run("UPDATE audit_runs SET status = 'completed', started_at = '2026-11-04T01:00:00.000Z', finished_at = ?, pages_done = ? WHERE id = ?",
        new Date(Date.parse("2026-11-04T01:00:00.000Z") + seconds * 1000).toISOString(), pages, id);
    };
    mkRun(20, 988);
    mkRun(80, 3273);
    const e = runsMod.estimateAuditDuration(20, 5);
    expect(e.basis).toBe("history");
    expect(e.secondsPerPageView).toBeGreaterThan(8);
    expect(e.secondsPerPageView).toBeLessThan(10);
    expect(e.label).toMatch(/^about 1[3-7]–1[6-9] min/);
  });
});

describe("BUG-20 / BUG-21: cancelled audits explain themselves", async () => {
  const runsMod = await import("../server/runs");
  it("records who cancelled a queued audit and explains each cancelled state", () => {
    const id = runsMod.insertRun(admin, projectId, { startUrl: "https://capitalhomemortgage.com/" } as never);
    runsMod.requestCancel(admin, id);
    const r = runsMod.getRun(admin, id);
    expect(r.cancelled_by_name).toBe("Admin");
    expect(runsMod.cancellationNote(r)).toMatch(/^Cancelled by Admin .* while waiting in the queue; it never started\.$/);
    // Historic record like 56531528: started, 109 raw findings collected, none imported, no canceller stored.
    const note = runsMod.cancellationNote({ ...r, cancelled_by_name: null, started_at: "2026-11-03T07:39:34.456Z", finished_at: "2026-11-03T07:39:56.100Z", findings_raw: 109, pages_done: 0 });
    expect(note).toMatch(/^Cancelled .* after 22 s\. 109 raw findings collected so far were not imported\.$/);
  });
});
