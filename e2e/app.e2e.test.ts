// End-to-end: drives the real production build (web + worker processes) with a real browser
// against a local fixture website. Requires `npm run build` first (npm run test:e2e does this).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { startFixtureServer } from "../test/fixtureServer";
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const PORT = 3100;
const APP = `http://127.0.0.1:${PORT}`;
const ADMIN = { name: "E2E Admin", email: "admin@e2e.test", password: "correct horse battery staple" };
const QA = { name: "Outside QA", email: "qa@e2e.test", password: "another long password" };

let site: Awaited<ReturnType<typeof startFixtureServer>>;
let site2: Awaited<ReturnType<typeof startFixtureServer>>; // second project on another host
let dataDir: string;
const procs: ChildProcess[] = [];
let browser: Browser;
let workerProc: ChildProcess;
const db = () => new DatabaseSync(join(dataDir, "webaudit.db"), { readOnly: true });
const q = <T,>(sql: string, ...p: (string | number)[]) => { const d = db(); try { return d.prepare(sql).all(...p) as T[]; } finally { d.close(); } };
let admin: BrowserContext;
let page: Page;

// Shared state between the ordered scenarios below.
let projectId = "";
let runId = "";
let issueId = "";
let issueUrl = "";
let evidenceSrc = "";
let xlsxHref = "";
let approvalLink = "";

function startProc(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, WEBAUDIT_DATA_DIR: dataDir, WEBAUDIT_TEST_ALLOW_LOOPBACK: "1", WEBAUDIT_APP_URL: APP, PORT: String(PORT), NODE_ENV: "production", WEBAUDIT_WORKER_STALE_MS: "4000", WEBAUDIT_WORKER_HEARTBEAT_MS: "1000" }; // heartbeat well inside the stale window (was 5 s vs 4 s: intermittent "stale")
  const p = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d: Buffer) => process.env.E2E_VERBOSE && process.stdout.write(d));
  p.stderr.on("data", (d: Buffer) => process.env.E2E_VERBOSE && process.stderr.write(d));
  procs.push(p);
  return p;
}

/** Set E2E_SCREENSHOTS=1 to save desktop + phone screenshots of key screens to test-results/. */
async function snap(name: string, target: Page = page) {
  if (!process.env.E2E_SCREENSHOTS) return;
  await target.screenshot({ path: `test-results/${name}-desktop.png`, fullPage: true });
  const size = target.viewportSize();
  await target.setViewportSize({ width: 390, height: 844 });
  await target.screenshot({ path: `test-results/${name}-phone.png`, fullPage: true });
  if (size) await target.setViewportSize(size);
}

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${APP}/login`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("App did not start");
}

async function waitForRun(id: string, statuses = ["completed"]) {
  const seen = new Set<string>();
  await page.goto(`${APP}/audits/${id}`);
  for (let i = 0; i < 360; i++) {
    const status = await page.locator("[data-testid=run-progress]").getAttribute("data-status");
    if (status) seen.add(status);
    if (status && statuses.includes(status)) return seen;
    if (status === "failed") throw new Error(`Audit failed: ${await page.locator("[data-testid=run-progress]").innerText()}`);
    await page.waitForTimeout(500);
  }
  throw new Error(`Audit ${id} did not finish; saw ${[...seen].join(", ")}`);
}

beforeAll(async () => {
  if (process.env.E2E_SCREENSHOTS) mkdirSync("test-results", { recursive: true });
  site = await startFixtureServer();
  site2 = await startFixtureServer({ hostname: "localhost" });
  dataDir = mkdtempSync(join(tmpdir(), "webaudit-e2e-"));
  startProc([resolve("node_modules/next/dist/bin/next"), "start", "-p", String(PORT), "-H", "127.0.0.1"]);
  workerProc = startProc([resolve("node_modules/tsx/dist/cli.mjs"), "worker/worker.ts"]);
  await waitForApp();
  browser = await chromium.launch({ channel: "msedge" });
  admin = await browser.newContext({ acceptDownloads: true });
  page = await admin.newPage();
});

afterAll(async () => {
  await browser?.close();
  for (const p of procs) {
    if (p.pid && process.platform === "win32") {
      try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ }
    } else p.kill();
  }
  await site?.close();
  await site2?.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

describe("WebAudit Pro end to end", () => {
  it("first run: creates the admin account", async () => {
    await page.goto(`${APP}/`);
    await page.waitForURL(/\/setup$/);
    await page.getByLabel("Name").fill(ADMIN.name);
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
    await page.getByLabel("Confirm password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Create admin and continue" }).click();
    await page.waitForURL(`${APP}/`);
    await expect(page.getByRole("heading", { name: "Overview" }).isVisible()).resolves.toBe(true);
  });

  it("Test 1: creates a website project and keeps it after reload", async () => {
    await page.goto(`${APP}/projects/new`);
    await page.getByLabel("Project name").fill("Fixture Mortgage");
    await page.getByLabel("Website address").fill(site.origin);
    await page.getByLabel("Authorization").fill("E2E fixture site owned by the test");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Add website" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    projectId = page.url().split("/").pop()!;
    await page.reload();
    expect(await page.getByRole("heading", { level: 1 }).innerText()).toBe("Fixture Mortgage");
    await page.goto(`${APP}/projects`);
    expect(await page.getByText("Fixture Mortgage").count()).toBeGreaterThan(0);
  });

  it("Tests 2–3: starts a real audit and shows persistent progress across a reload", async () => {
    await page.goto(`${APP}/audits/new?project=${projectId}`);
    expect(await page.getByLabel("Website URL").inputValue()).toBe(`${site.origin}/`);
    await page.getByText("Advanced settings (optional)").click();
    await page.getByLabel("Maximum pages").fill("5");
    await page.getByLabel("Scan rate: delay between page loads (ms)").fill("500");
    for (const vw of ["320px", "768px", "1024px"]) await page.getByLabel(vw, { exact: true }).uncheck();
    await page.getByRole("button", { name: "Start Audit" }).click();
    await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/);
    runId = page.url().split("/").pop()!;

    const firstStatus = await page.locator("[data-testid=run-progress]").getAttribute("data-status");
    expect(["pending", "running"]).toContain(firstStatus);
    await page.reload(); // progress lives in the database, so a refresh resumes the same run
    expect(await page.locator("[data-testid=run-progress]").count()).toBe(1);

    const seen = await waitForRun(runId);
    expect(seen.has("completed")).toBe(true);
    await page.reload();
    expect(await page.getByTestId("quality-score").isVisible()).toBe(true);
    const api = await page.request.get(`${APP}/api/runs/${runId}`);
    const json = await api.json();
    expect(json).toMatchObject({ status: "completed", pagesDone: 2 });
    expect(json.findings).toBeGreaterThan(0);
    await snap("audit-complete");
  });

  it("Tests 4–6: opens results, the screenshot evidence and Current vs Proposed", async () => {
    await page.goto(`${APP}/issues?run=${runId}&q=Page%20scrolls`);
    await page.getByRole("link", { name: "Page scrolls sideways" }).first().click();
    await page.waitForURL(/\/issues\/[0-9a-f-]{36}\?from=/);
    issueUrl = page.url().split("?")[0];
    issueId = issueUrl.split("/").pop()!;

    expect(await page.getByTestId("current-value").innerText()).toMatch(/document width \d+px at 390px viewport/);
    expect(await page.getByTestId("proposed-value").innerText()).toContain("390px");
    const img = page.getByTestId("evidence-image").first();
    await img.waitFor();
    await page.waitForFunction((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0, await img.elementHandle());
    evidenceSrc = (await img.getAttribute("src"))!;
    expect(evidenceSrc).toContain(`/api/evidence/${runId}/annotated/`);
    await page.getByRole("button", { name: "390px full page" }).click();
    expect(await page.locator("img[alt='Full-page screenshot at 390px']").count()).toBe(1);
    await page.goto(issueUrl);
    await snap("issue-detail");
    await page.goto(`${APP}/issues?run=${runId}`);
    await snap("issue-finder");
  });

  it("P0 regression: /issues renders with the exact empty-parameter URL the filter form submits", async () => {
    const empty = "q=&project=&run=&url=&type=&severity=&viewport=&kind=&verification=&review=&assignee=&provider=&conf=&sort=";
    const res = await page.goto(`${APP}/issues?${empty}`);
    expect(res?.status()).toBe(200);
    expect(await page.getByRole("heading", { name: "Issues" }).isVisible()).toBe(true);
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
    // The real interaction: submit the filter form unchanged, then with a filter and a sort.
    await page.getByRole("button", { name: "Apply filters" }).click();
    await page.waitForURL(/sort=/);
    expect(await page.getByText("This page couldn't be loaded").count()).toBe(0);
    await page.locator("select[name=severity]").selectOption("high");
    await page.locator("select[name=sort]").selectOption("confidence");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await page.waitForURL(/severity=high/);
    const sev = await page.locator("tbody tr td:nth-child(4)").allInnerTexts();
    expect(sev.length).toBeGreaterThan(0);
    expect(sev.every((t) => t.trim().toLowerCase() === "high")).toBe(true);
    // Hostile parameters are ignored rather than crashing the page.
    expect((await page.goto(`${APP}/issues?sort=x%3B%20DROP%20TABLE%20issues&page=-3&viewport=abc&size=99999`))?.status()).toBe(200);
  });

  it("Test 7: records a review decision with a note and keeps it after reload", async () => {
    await page.goto(issueUrl);
    await page.getByLabel("Note (optional, saved with the decision)").fill("Verified at 390px");
    await page.getByRole("button", { name: "Confirm finding" }).click();
    await page.getByText("Saved.").waitFor();
    await page.reload();
    const history = await page.getByTestId("history").innerText();
    expect(history).toContain("Confirmed finding");
    expect(history).toContain("Verified at 390px");
    expect(await page.getByTestId("notes").innerText()).toContain("Verified at 390px");
  });

  it("Tests 8–9: generates, downloads and opens real Excel and PDF reports", async () => {
    await page.goto(`${APP}/reports?run=${runId}`);
    for (const label of ["Generate Excel (.xlsx)", "Generate PDF"]) {
      await page.getByRole("button", { name: label }).click();
      await page.getByText("Report queued").waitFor();
    }
    await page.getByTestId("download-xlsx").first().waitFor({ timeout: 120_000 });
    await page.getByTestId("download-pdf").first().waitFor({ timeout: 120_000 });

    xlsxHref = (await page.getByTestId("download-xlsx").first().getAttribute("href"))!;
    const xlsx = await page.request.get(`${APP}${xlsxHref}`);
    expect(xlsx.headers()["content-disposition"]).toMatch(/attachment; filename=".*\.xlsx"/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await xlsx.body()) as unknown as ArrayBuffer);
    expect(wb.worksheets.slice(0, 8).map((w) => w.name)).toEqual(["Executive Overview", "All Issues", "Confirmed Issues", "Recommendations", "Needs Review", "Developer Action Tracker", "Pages Audited", "Audit Metadata"]);
    expect(wb.worksheets).toHaveLength(17); // + 9 Google sheets (with "No data" rows when Google wasn't used)
    const ids = wb.getWorksheet("All Issues")!.getColumn(1).values.slice(2).map(String);
    expect(ids.some((id) => id.startsWith("LAY-"))).toBe(true);

    const pdfHref = (await page.getByTestId("download-pdf").first().getAttribute("href"))!;
    await snap("reports");
    const pdf = await page.request.get(`${APP}${pdfHref}`);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("Tests 10–11: creates a client approval link; the client decides; the trail is kept", async () => {
    await page.goto(`${APP}/approvals?run=${runId}`);
    await page.getByRole("button", { name: "Create private approval link" }).click();
    approvalLink = await page.getByTestId("approval-link").inputValue();
    expect(approvalLink).toMatch(/\/approve\/[A-Za-z0-9_-]{40,}$/);

    const client = await browser.newContext(); // no session: the token is the only credential
    const portal = await client.newPage();
    await portal.goto(approvalLink.replace(/^https?:\/\/[^/]+/, APP));
    expect(await portal.getByTestId("portal-finding").count()).toBe(1);
    const shot = portal.locator("[data-testid=portal-finding] img").first();
    await portal.waitForFunction((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0, await shot.elementHandle());
    await snap("client-portal", portal);
    expect(await portal.getByText("Approving does not change your website.").count()).toBe(1);
    expect(await portal.getByText("Expected benefit:").count()).toBe(1);
    expect(await portal.getByText("Awaiting your decision").count()).toBe(1);
    await portal.getByLabel("Approve").check();
    await portal.locator("textarea[name^='comment:']").fill("Please fix on mobile");
    await portal.getByLabel("Your name").fill("Client E2E");
    await portal.getByLabel("Your email").fill("client@e2e.test");
    await portal.getByRole("button", { name: "Submit decisions" }).click();
    await portal.getByText("1 decision recorded").waitFor();

    // A finding that was not released is not reachable through the token.
    const token = approvalLink.split("/").pop()!;
    const other = await client.request.get(`${APP}/api/portal/${token}/00000000-0000-0000-0000-000000000000/annotated`);
    expect(other.status()).toBe(404);
    await client.close();

    await page.goto(`${APP}/approvals`);
    await page.getByRole("link", { name: /audit findings for approval/ }).first().click();
    const log = await page.getByTestId("decision-log").innerText();
    expect(log).toContain("Client E2E");
    expect(log).toContain("Please fix on mobile");
    await page.goto(issueUrl);
    expect(await page.getByTestId("history").innerText()).toContain("Client approved");
  });

  it("Test 12: runs a second audit after a fix and compares the runs", async () => {
    site.state.fixed = true; // the developer removed the overflowing element
    await page.goto(`${APP}/reaudit?project=${projectId}`);
    await page.getByRole("button", { name: "Run fresh audit with the same settings" }).click();
    await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/);
    const run2 = page.url().split("/").pop()!;
    expect(run2).not.toBe(runId);
    await waitForRun(run2);

    await page.goto(`${APP}/reaudit?base=${runId}&latest=${run2}`);
    const resolved = page.locator("[data-testid=compare-row][data-status=resolved]", { hasText: "Page scrolls sideways" });
    expect(await resolved.count()).toBe(1);
    expect(await page.locator("[data-testid=compare-row][data-status=still_present]").count()).toBeGreaterThan(0);
    await snap("reaudit");
    await page.goto(`${APP}/`);
    await snap("overview");
  });

  it("Test 3b: cancels a running audit from the progress page", async () => {
    await page.goto(`${APP}/audits/new?project=${projectId}`);
    await page.getByText("Advanced settings (optional)").click();
    await page.getByLabel("Scan rate: delay between page loads (ms)").fill("3000"); // slow, so there is time to cancel
    await page.getByRole("button", { name: "Start Audit" }).click();
    await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    await page.locator("[data-testid=run-progress][data-status=running]").waitFor({ timeout: 60_000 });
    await page.getByTestId("cancel-audit").click();
    const seen = await waitForRun(id, ["cancelled"]);
    expect(seen.has("cancelled")).toBe(true);
    const json = await (await page.request.get(`${APP}/api/runs/${id}`)).json();
    expect(json.status).toBe("cancelled");
    expect(json.pagesDone).toBeLessThan(2);
    // BUG-21: the detail page uses the run's own times: queued, started (it did start), cancelled; elapsed = run time.
    await page.reload();
    expect(await page.getByRole("heading", { level: 1 }).locator("xpath=..").innerText()).toMatch(/queued .* started .* cancelled /);
    expect(await page.getByTestId("elapsed").innerText()).toMatch(/^Ran for /);
  });

  it("Test 13: users outside a project and anonymous visitors cannot see its data", async () => {
    await page.goto(`${APP}/settings`);
    await page.locator("#u-name").fill(QA.name);
    await page.locator("#u-email").fill(QA.email);
    await page.locator("#u-password").fill(QA.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText(`Account created for ${QA.email}`).waitFor();

    const outsider = await browser.newContext();
    const qa = await outsider.newPage();
    await qa.goto(`${APP}/login`);
    await qa.getByLabel("Email").fill(QA.email);
    await qa.getByLabel("Password").fill(QA.password);
    await qa.getByRole("button", { name: "Sign in" }).click();
    await qa.waitForURL(`${APP}/`);
    await qa.goto(`${APP}/issues`);
    expect(await qa.getByText("No issues yet").count()).toBe(1);
    await qa.goto(issueUrl);
    await qa.getByRole("heading", { name: "Not found" }).waitFor();
    expect(await qa.getByTestId("plain-summary").count()).toBe(0);
    expect((await qa.request.get(`${APP}${xlsxHref}`)).status()).toBe(404);
    expect((await qa.request.get(`${APP}${evidenceSrc}`)).status()).toBe(404);
    expect((await qa.request.get(`${APP}/api/runs/${runId}`)).status()).toBe(404);
    await outsider.close();

    const anon = await browser.newContext();
    expect((await anon.request.get(`${APP}${xlsxHref}`)).status()).toBe(401);
    expect((await anon.request.get(`${APP}${evidenceSrc}`)).status()).toBe(401);
    const anonPage = await anon.newPage();
    await anonPage.goto(`${APP}/issues`);
    expect(anonPage.url()).toBe(`${APP}/login`);
    await anonPage.goto(`${APP}/approve/not-a-real-token`);
    expect(await anonPage.getByTestId("portal-unavailable").count()).toBe(1);
    await anon.close();
  });

  it("Test 15: Google SEO & Performance shows real structured data and truthful integration states", async () => {
    await page.goto(`${APP}/google?project=${projectId}`);
    const health = page.getByTestId("website-health");
    expect(await health.locator("[data-section=structured][data-state=ok]").count()).toBe(1);
    expect(await health.locator("[data-section=visibility][data-state=not-connected]").count()).toBe(1);
    expect(await health.locator("[data-section=performance][data-state=not-run]").count()).toBe(1);
    await snap("google-overview");

    await page.goto(`${APP}/google/connections?project=${projectId}`);
    expect(await page.getByTestId("setup-step-key-saved").getAttribute("data-state")).toBe("todo");
    expect(await page.getByTestId("setup-step-account").innerText()).toMatch(/OAuth client isn't set up/);
    await snap("google-connections");

    await page.goto(`${APP}/google/structured-data?project=${projectId}&run=${runId}`);
    const rrt = page.getByTestId("open-rrt").first();
    expect(await rrt.getAttribute("href")).toMatch(/^https:\/\/search\.google\.com\/test\/rich-results\?url=http%3A%2F%2F127\.0\.0\.1/);
    expect(await page.getByText("Event: Not eligible: missing or invalid required properties").count()).toBeGreaterThan(0);
    // BUG-12 retest: a fresh audit (current rules) reports the empty datePublished once, as empty, and never "wrong type".
    expect(await page.getByText('Recommended property "datePublished" is empty').count()).toBeGreaterThan(0);
    expect(await page.getByText('"datePublished" has the wrong type').count()).toBe(0);
    expect(await page.getByText('Recommended property "datePublished" is missing').count()).toBe(0);
    expect(await page.getByText("Article: Not eligible").count()).toBe(0);
    expect(await page.getByTestId("sd-rules-version").first().innerText()).toBe("Checked with rules 2026-11-04");
    // UX-12: summary by type, errors-only filter, collapsible pages.
    const summary = await page.getByTestId("sd-summary").innerText(); // sorted by errors, so order isn't fixed
    expect(summary).toContain("Article");
    expect(summary).toContain("Event");
    const allPages = await page.getByTestId("sd-page").count();
    await page.getByTestId("sd-errors-only").click();
    await page.waitForURL(/only=errors/);
    const errorPages = await page.getByTestId("sd-page").count();
    expect(errorPages).toBeGreaterThan(0);
    expect(errorPages).toBeLessThanOrEqual(allPages);
    await snap("google-structured-data");

    await page.goto(`${APP}/google/pagespeed?project=${projectId}`);
    expect(await page.getByTestId("psi-health").getAttribute("data-state")).toBe("not-configured");
    expect(await page.getByTestId("psi-health").innerText()).toContain("PageSpeed not set up");
    await page.goto(`${APP}/issues?run=${runId}&provider=schema`);
    expect(await page.getByText("Internal Schema Validator").count()).toBeGreaterThan(0);
    await page.goto(`${APP}/audits/new?project=${projectId}`);
    expect(await page.locator("input[name=psiMobile]").isDisabled()).toBe(true);
    expect(await page.locator("input[name=gscPerformance]").isDisabled()).toBe(true);
  });

  describe("bug fixes: project selection and worker reliability", () => {
    let redRiverId = "";

    it("Bug Test 1: switching project updates URL, authorized domain and defaults, and survives reload", async () => {
      await page.goto(`${APP}/projects/new`);
      await page.getByLabel("Project name").fill("Red River Fixture");
      await page.getByLabel("Website address").fill(site2.origin);
      await page.getByLabel("Authorization").fill("Second local fixture site");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Add website" }).click();
      await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
      redRiverId = page.url().split("/").pop()!;
      await page.getByLabel("Default max pages").fill("7");
      await page.getByRole("button", { name: "Save settings" }).click();
      await page.getByText("Project settings saved.").waitFor();

      await page.goto(`${APP}/audits/new?project=${projectId}`);
      expect(await page.getByLabel("Website URL").inputValue()).toBe(`${site.origin}/`);
      expect(await page.getByTestId("authorized-domain").innerText()).toBe("127.0.0.1");
      expect(await page.getByLabel("Maximum pages").inputValue()).toBe("20");

      await page.getByLabel("Project", { exact: true }).selectOption(redRiverId);
      expect(await page.getByLabel("Website URL").inputValue()).toBe(`${site2.origin}/`);
      expect(await page.getByTestId("authorized-domain").innerText()).toBe("localhost");
      expect(await page.getByTestId("url-scope-message").innerText()).toContain("Must be on localhost");
      expect(await page.getByLabel("Maximum pages").inputValue()).toBe("7");
      await page.waitForURL(new RegExp(`project=${redRiverId}`));
      await page.reload();
      expect(await page.getByLabel("Project", { exact: true }).inputValue()).toBe(redRiverId);
      expect(await page.getByLabel("Website URL").inputValue()).toBe(`${site2.origin}/`);
    });

    it("Bug Test 3: a URL from another project is flagged in the browser and rejected by the server", async () => {
      await page.goto(`${APP}/audits/new?project=${redRiverId}`);
      await page.getByLabel("Website URL").fill(`${site.origin}/`);
      expect(await page.getByTestId("url-scope-message").innerText()).toBe("This URL belongs to 127.0.0.1, not localhost. Correct the URL or select the matching project.");
      expect(await page.getByTestId("start-audit").isDisabled()).toBe(true);

      const before = q<{ n: number }>("SELECT (SELECT COUNT(*) FROM audit_runs) + (SELECT COUNT(*) FROM jobs) AS n")[0].n;
      // Bypass the browser check entirely: the server must still refuse.
      await page.getByTestId("start-audit").evaluate((b) => { (b as HTMLButtonElement).disabled = false; (b as HTMLButtonElement).form!.requestSubmit(b as HTMLButtonElement); });
      await page.getByText("You selected Red River Fixture, but the entered URL belongs to 127.0.0.1. Correct the URL or select the matching project.").waitFor();
      expect(q<{ n: number }>("SELECT (SELECT COUNT(*) FROM audit_runs) + (SELECT COUNT(*) FROM jobs) AS n")[0].n).toBe(before);
    });

    it("Bug Test 2: Start Audit saves the selected project, its URL and settings, and the progress page names it", async () => {
      await page.goto(`${APP}/audits/new?project=${projectId}`);
      await page.getByLabel("Project", { exact: true }).selectOption(redRiverId);
      await page.getByText("Advanced settings (optional)").click();
      for (const vw of ["320px", "768px", "1024px"]) await page.getByLabel(vw, { exact: true }).uncheck();
      await page.getByLabel("Scan rate: delay between page loads (ms)").fill("500");
      await page.getByTestId("start-audit").click();
      await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/);
      const id = page.url().split("/").pop()!;
      expect(await page.getByTestId("progress-project").innerText()).toBe("Red River Fixture");
      const [r] = q<{ project_id: string; start_url: string; settings_json: string }>("SELECT project_id, start_url, settings_json FROM audit_runs WHERE id = ?", id);
      expect(r.project_id).toBe(redRiverId);
      expect(r.start_url).toBe(`${site2.origin}/`);
      expect(JSON.parse(r.settings_json)).toMatchObject({ maxPages: 7, viewports: [390, 1440], delayMs: 500 });
      await waitForRun(id);
      expect(await page.getByRole("heading", { level: 1 }).innerText()).toBe("Audit: Red River Fixture");
    });

    it("Bug Test 8: findings, evidence and exports stay with their own project", async () => {
      const crossed = q<{ n: number }>(
        `SELECT COUNT(*) AS n FROM issues i JOIN projects p ON p.id = i.project_id
         WHERE (p.id = ? AND i.url NOT LIKE ?) OR (p.id = ? AND i.url NOT LIKE ?)`, projectId, `${site.origin}%`, redRiverId, `${site2.origin}%`)[0].n;
      expect(crossed).toBe(0);
      const mismatchedRuns = q<{ n: number }>("SELECT COUNT(*) AS n FROM issues i JOIN audit_runs r ON r.id = i.run_id WHERE r.project_id != i.project_id")[0].n;
      expect(mismatchedRuns).toBe(0);
      await page.goto(`${APP}/issues?project=${projectId}`);
      expect(await page.locator(`text=${site2.origin.replace("http://", "")}`).count()).toBe(0);

      const rrRun = q<{ id: string }>("SELECT id FROM audit_runs WHERE project_id = ? AND status = 'completed'", redRiverId)[0].id;
      await page.goto(`${APP}/reports?run=${rrRun}`);
      await page.getByRole("button", { name: "Generate JSON" }).click();
      await page.getByText("Report queued").waitFor();
      const link = page.locator("[data-testid=download-json]").first();
      await link.waitFor({ timeout: 60_000 });
      const json = await (await page.request.get(`${APP}${await link.getAttribute("href")}`)).json();
      expect(json.project.name).toBe("Red River Fixture");
      expect(json.issues.every((i: { url: string }) => i.url.startsWith(site2.origin))).toBe(true);
    });

    it("Bug Tests 6–7: with the worker stopped the UI says so; a retry can't duplicate; restarting runs the queued audit", async () => {
      // Stop the worker.
      if (workerProc.pid) execSync(`taskkill /pid ${workerProc.pid} /T /F`, { stdio: "ignore" });
      await expect.poll(async () => {
        await page.goto(`${APP}/audits/new?project=${projectId}`);
        return page.getByTestId("worker-status").getAttribute("data-state");
      }, { timeout: 20_000, interval: 1000 }).toMatch(/stale|offline/);
      expect(await page.getByTestId("nav-worker").getAttribute("data-state")).toMatch(/stale|offline/);

      await page.getByText("Advanced settings (optional)").click();
      for (const vw of ["320px", "768px", "1024px"]) await page.getByLabel(vw, { exact: true }).uncheck();
      await page.getByTestId("start-audit").click();
      await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/);
      const id = page.url().split("/").pop()!;
      expect(await page.locator("[data-testid=run-progress]").getAttribute("data-status")).toBe("pending");
      expect(await page.getByTestId("progress-message").innerText()).toBe("Queued, but the audit worker isn't running.");
      expect(await page.getByTestId("worker-warning").isVisible()).toBe(true);

      // Retrying must not queue a duplicate audit of the same project.
      await page.goto(`${APP}/audits/new?project=${projectId}`);
      await page.getByTestId("start-audit").click();
      await page.getByText("An audit of this project is already queued or running").waitFor();
      expect(q<{ n: number }>("SELECT COUNT(*) AS n FROM audit_runs WHERE project_id = ? AND status = 'pending'", projectId)[0].n).toBe(1);

      // Restart the worker: the queued audit is picked up and completes.
      workerProc = startProc([resolve("node_modules/tsx/dist/cli.mjs"), "worker/worker.ts"]);
      await waitForRun(id);
      await page.reload(); // the sidebar status is rendered on navigation
      expect(await page.getByTestId("nav-worker").getAttribute("data-state")).toBe("online");
    });
  });

  it("GQA-01/G3: Google Connections checks credential formats and guides setup (no Google requests)", async () => {
    // Synthetic values in Google's documented shapes; nothing here is sent to Google (saving never calls Google).
    const secretLike = `GOCSPX-${"e".repeat(28)}`;
    const keyLike = `AIza${"E".repeat(35)}`;
    await page.goto(`${APP}/google/connections?project=${projectId}`);
    expect(await page.getByTestId("setup-checklist").locator("li").count()).toBe(5);
    expect(await page.getByText("Google API key: usually starts with AIza").count()).toBe(1);
    expect(await page.getByText("OAuth client ID: ends with .apps.googleusercontent.com").count()).toBe(1);
    expect(await page.getByText("OAuth client secret: typically starts with GOCSPX-").count()).toBe(1);

    // The browser flags the wrong shape before submitting...
    const apiKey = page.locator("#apiKey");
    await apiKey.fill(secretLike);
    expect(await apiKey.evaluate((el: HTMLInputElement) => el.validity.patternMismatch)).toBe(true);
    // ...and the server refuses it even without the browser check, without echoing the value.
    await apiKey.evaluate((el: HTMLInputElement) => el.removeAttribute("pattern"));
    await page.getByRole("button", { name: "Save credentials" }).click();
    await page.getByText(/looks like an OAuth client secret, not a Google API key/).waitFor();
    expect(await page.content()).not.toContain(secretLike);
    expect(await page.getByTestId("setup-step-key-saved").getAttribute("data-state")).toBe("todo");

    // A key in the right shape is saved but not treated as proof that Google accepts it.
    await page.locator("#apiKey").fill(keyLike);
    await page.getByRole("button", { name: "Save credentials" }).click();
    await page.getByText(/Google credentials saved/).waitFor();
    await page.goto(`${APP}/google/connections?project=${projectId}`);
    expect(await page.getByTestId("setup-step-key-saved").getAttribute("data-state")).toBe("done");
    expect(await page.getByTestId("setup-step-key-format").getAttribute("data-state")).toBe("unverified");
    expect(await page.getByTestId("psi-health").getAttribute("data-state")).toBe("untested");
    expect(await page.getByText(/Last change: API key added on .+ by E2E Admin/).count()).toBe(1);
    expect(await page.getByTestId("cloud-credentials-link").getAttribute("href")).toMatch(/^https:\/\/console\.cloud\.google\.com\/apis\/credentials/);
    expect(await page.content()).not.toContain(keyLike);
    await snap("google-connections-checklist");

    // Restore: remove the key so later tests see the original state.
    await page.locator("input[name=removeApiKey]").check();
    await page.getByRole("button", { name: "Save credentials" }).click();
    await page.getByText(/Google credentials saved/).waitFor();
    await page.goto(`${APP}/google/connections?project=${projectId}`);
    expect(await page.getByTestId("setup-step-key-saved").getAttribute("data-state")).toBe("todo");
  });

  it("BUG-10: loading Overview and Issues makes no failing background requests (prefetch is off by design)", async () => {
    const rsc: string[] = [];
    const failed: string[] = [];
    const bad: string[] = [];
    const onReq = (r: import("playwright").Request) => { if (r.url().includes("_rsc=")) rsc.push(new URL(r.url()).pathname); };
    const onFail = (r: import("playwright").Request) => failed.push(`${r.failure()?.errorText} ${new URL(r.url()).pathname}`);
    const onRes = (r: import("playwright").Response) => { if (r.status() >= 500) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); };
    page.on("request", onReq); page.on("requestfailed", onFail); page.on("response", onRes);
    try {
      for (const path of ["/", `/issues?run=${runId}`]) {
        await page.goto(`${APP}${path}`);
        await page.waitForTimeout(3000); // the retest waited 5 s on Overview; prefetches fire within the first second
      }
    } finally {
      page.off("request", onReq); page.off("requestfailed", onFail); page.off("response", onRes);
    }
    expect(bad).toEqual([]);
    expect(rsc).toEqual([]); // no background server renders the user didn't ask for
    expect(failed.filter((f) => !f.includes("/api/evidence/"))).toEqual([]);
  });

  it("BUG-10: navigating every sidebar link and Google tab uses client navigation with no 5xx responses", async () => {
    const bad: string[] = [];
    const docs: string[] = [];
    const csp: string[] = [];
    const onConsole = (m: import("playwright").ConsoleMessage) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text().slice(0, 160)); };
    page.on("console", onConsole);
    const onResponse = (r: import("playwright").Response) => {
      if (r.status() >= 500) bad.push(`${r.status()} ${new URL(r.url()).pathname}${new URL(r.url()).search.slice(0, 10)}`);
      if (r.request().resourceType() === "document") docs.push(new URL(r.url()).pathname);
    };
    page.on("response", onResponse);
    try {
      await page.goto(`${APP}/`);
      await page.waitForTimeout(1500); // let the Overview prefetches finish
      docs.length = 0;
      for (const name of ["My Websites", "New Audit", "Audit Runs", "Issues", "Review Queue", "Reports", "Client Approvals", "Re-Audit", "Google SEO & Performance", "Settings", "Help", "Overview"]) {
        await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true }).click();
        await page.waitForLoadState("networkidle");
      }
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Google SEO & Performance", exact: true }).click();
      await page.waitForLoadState("networkidle");
      for (const tab of ["PageSpeed Insights", "Structured Data", "Search Console Performance", "URL Inspection", "Sitemaps", "SEO History & Reports", "Google Connections", "SEO Overview"]) {
        await page.getByRole("link", { name: tab, exact: true }).first().click();
        await page.waitForLoadState("networkidle");
      }
    } finally {
      page.off("response", onResponse);
    }
    page.off("console", onConsole);
    expect(bad).toEqual([]);
    expect(docs).toEqual([]); // every click was a client-side navigation, never a full page reload
    // CSP is report-only: record what an enforced policy would block (evidence for the approval decision).
    mkdirSync(resolve("test-results"), { recursive: true });
    writeFileSync(resolve("test-results", "csp-report-only.json"), JSON.stringify({ violations: csp.length, samples: [...new Set(csp)].slice(0, 20) }, null, 2));
  });

  it("BUG-22/23: detail pages have descriptive titles; unknown addresses get a branded 404 with ways back", async () => {
    await page.goto(issueUrl);
    expect(await page.title()).toMatch(/^[A-Z0-9]+-\d{4}: .+ · Fixture Mortgage · WebAudit Pro$/);
    await page.goto(`${APP}/audits/${runId}`);
    expect(await page.title()).toMatch(/^Audit .+ · Fixture Mortgage · WebAudit Pro$/);
    await page.goto(`${APP}/projects/${projectId}`);
    expect(await page.title()).toBe("Fixture Mortgage · WebAudit Pro");
    const res = await page.goto(`${APP}/this-page-does-not-exist`);
    expect(res?.status()).toBe(404);
    expect(await page.title()).toBe("Page not found · WebAudit Pro");
    expect(await page.getByRole("link", { name: "Go to Overview" }).count()).toBe(1);
  });

  describe("UX acceptance (from the real UI)", () => {
    it("UX 1: the dashboard shows the getting-started guide, websites, attention cards and system status; the guide can be hidden", async () => {
      // Admin: every step is done here, so the guide stays out of the way.
      await page.goto(`${APP}/`);
      expect(await page.getByTestId("getting-started").count()).toBe(0);
      expect(await page.getByTestId("dashboard-websites").innerText()).toContain("Fixture Mortgage");
      expect(await page.getByTestId("dashboard-worker").getAttribute("data-state")).toBe("online");
      expect(await page.getByTestId("dashboard-psi").innerText()).toContain("PageSpeed not set up");
      expect(await page.getByTestId("dashboard-gsc").innerText()).toContain("Search Console");
      await page.getByRole("link", { name: /High-priority findings/ }).click();
      await page.waitForURL(/quick=high/);
      // A new user (no websites yet) sees the guide with real progress, and hiding it is remembered.
      const ctx = await browser.newContext();
      const fresh = await ctx.newPage();
      await fresh.goto(`${APP}/login`);
      await fresh.getByLabel("Email").fill(QA.email);
      await fresh.getByLabel("Password").fill(QA.password);
      await fresh.getByRole("button", { name: "Sign in" }).click();
      await fresh.waitForURL(`${APP}/`);
      const guide = fresh.getByTestId("getting-started");
      expect(await guide.getByText("Welcome to WebAudit Pro").count()).toBe(1);
      expect(await guide.getByText("(done)").count()).toBe(0);
      await fresh.getByRole("button", { name: "Hide this guide" }).click();
      await fresh.getByRole("button", { name: "Show the getting-started guide" }).waitFor();
      await fresh.reload();
      expect(await fresh.getByTestId("getting-started").count()).toBe(0);
      await fresh.getByRole("button", { name: "Show the getting-started guide" }).click();
      await fresh.getByTestId("getting-started").waitFor();
      await ctx.close();
    });

    it("UX 2: quick filters work, a view can be saved and deleted, and Back from an issue keeps the filters", async () => {
      await page.goto(`${APP}/issues?run=${runId}`);
      const all = await page.locator("tbody tr").count();
      await page.getByTestId("quick-filters").getByRole("link", { name: "Mobile" }).click();
      await page.waitForURL(/quick=mobile/);
      expect(await page.getByTestId("quick-filters").getByRole("link", { name: "Mobile" }).getAttribute("aria-current")).toBe("page");
      const mobile = await page.locator("tbody tr td:nth-child(8)").allInnerTexts();
      expect(mobile.length).toBeGreaterThan(0);
      expect(mobile.every((v) => v.split(", ").some((x) => Number(x) < 768))).toBe(true);
      await page.getByTestId("quick-filters").getByRole("link", { name: "Desktop" }).click();
      await page.waitForURL(/quick=desktop/);
      expect(await page.locator("tbody tr").count()).toBeLessThanOrEqual(all);

      await page.getByText("Save current filters…").click();
      await page.getByLabel("View name").fill("Desktop issues");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByTestId("saved-views").getByRole("link", { name: "Desktop issues" }).waitFor();

      await page.locator("tbody tr td:nth-child(3) a").first().click();
      await page.waitForURL(/\/issues\/[0-9a-f-]{36}\?from=/);
      expect(await page.getByTestId("plain-summary").innerText()).toMatch(/What's wrong[\s\S]*Why it matters[\s\S]*Who fixes it/);
      expect(await page.getByText("Text recommendation only.").count()).toBe(1);
      await page.getByText("Technical details for developers").click();
      expect(await page.getByTestId("technical-details").innerText()).toContain("Selector");
      await page.getByRole("link", { name: "← Back to your filtered list" }).click();
      await page.waitForURL(/quick=desktop/);

      await page.getByRole("button", { name: "Delete saved view Desktop issues" }).click();
      await page.getByTestId("saved-views").getByText("none yet").waitFor();
    });

    it("UX 3: a custom report from selected issues previews and contains exactly those issues", async () => {
      await page.goto(`${APP}/issues?run=${runId}&sort=code`);
      await page.locator("tbody tr input[type=checkbox]").nth(0).check();
      await page.locator("tbody tr input[type=checkbox]").nth(1).check();
      await page.getByTestId("report-from-selected").click();
      await page.waitForURL(/\/reports\?/);
      expect(await page.getByTestId("selected-ids").innerText()).toContain("only the 2 issues you selected");
      expect(await page.getByTestId("report-preview").innerText()).toMatch(/include 2 findings/);
      const before = new Set(q<{ id: string }>("SELECT id FROM exports").map((r) => r.id));
      await page.getByRole("button", { name: "Generate JSON" }).click();
      await page.getByText("Report queued").waitFor();
      const created = q<{ id: string; filters_json: string }>("SELECT id, filters_json FROM exports WHERE format = 'json'").filter((r) => !before.has(r.id));
      expect(created).toHaveLength(1);
      expect(JSON.parse(created[0].filters_json).ids).toHaveLength(2);
      for (let t = 0; q<{ status: string }>("SELECT status FROM exports WHERE id = ?", created[0].id)[0].status !== "completed"; t++) {
        if (t > 120) throw new Error("export did not complete");
        await new Promise((r) => setTimeout(r, 500));
      }
      const json = await (await page.request.get(`${APP}/api/exports/${created[0].id}`)).json();
      expect(json.issues).toHaveLength(2);
    });

    it("BUG-15 / UX-06: changing a report option disables Generate until the preview has refreshed by itself", async () => {
      await page.goto(`${APP}/reports?run=${runId}`);
      const before = await page.getByTestId("report-preview").innerText();
      await page.getByLabel("Severity").selectOption("low");
      expect(await page.getByTestId("generate-guard").getAttribute("data-stale")).toBe("1"); // stale: buttons disabled at once
      expect(await page.getByRole("button", { name: "Generate PDF" }).isDisabled()).toBe(true);
      await page.waitForURL(/severity=low/); // no "Update preview" click
      await page.locator("[data-testid=generate-guard][data-stale='0']").waitFor();
      const after = await page.getByTestId("report-preview").innerText();
      expect(after).not.toBe(before);
      const total = Number((after.match(/include (\d+) finding/) ?? [0, 0])[1]);
      expect(await page.getByRole("button", { name: "Generate PDF" }).isDisabled()).toBe(total === 0);
    });

    it("UX-03: a reviewer classifies 20 findings in the review queue without going back to the Issues list", async () => {
      const unreviewed = () => q<{ n: number }>("SELECT COUNT(*) AS n FROM issues WHERE run_id = ? AND verification_status = 'unverified' AND review_status = 'pending'", runId)[0].n;
      const start = unreviewed();
      const target = Math.min(20, start);
      expect(target).toBeGreaterThan(0);
      const visited: string[] = [];
      page.on("framenavigated", (f) => { if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname); });
      await page.goto(`${APP}/review?run=${runId}`);
      for (let n = 0; n < target; n++) {
        const item = page.getByTestId("queue-item");
        await item.waitFor();
        const id = await item.getAttribute("data-issue");
        await page.keyboard.press(n % 5 === 4 ? "f" : "a"); // A = accept / approve, F = false positive
        await page.waitForFunction((prev) => !document.querySelector(`[data-issue="${prev}"]`), id);
      }
      page.removeAllListeners("framenavigated");
      expect(unreviewed()).toBe(start - target);
      expect(visited.filter((p) => p.startsWith("/issues"))).toEqual([]);
      // Progress persists across a reload, and the last decision can be undone.
      await page.reload();
      const total = q<{ n: number }>("SELECT COUNT(*) AS n FROM issues WHERE run_id = ?", runId)[0].n;
      if (await page.getByTestId("review-progress").count()) expect(await page.getByTestId("review-progress").innerText()).toContain(`${total - unreviewed()} of ${total} reviewed`);
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByText("Undone. The finding is back in the queue.").waitFor();
      expect(unreviewed()).toBe(start - target + 1);
    });

    it("UX-19: an admin changes a role, disables/re-enables and resets a password; the user is signed out each time", async () => {
      const ctx = await browser.newContext();
      const other = await ctx.newPage();
      const signIn = async (password: string) => {
        await other.goto(`${APP}/login`);
        await other.getByLabel("Email").fill(QA.email);
        await other.getByLabel("Password").fill(password);
        await other.getByRole("button", { name: "Sign in" }).click();
      };
      await signIn(QA.password);
      await other.waitForURL(`${APP}/`);
      const row = () => page.locator("li", { hasText: QA.email });

      await page.goto(`${APP}/settings`);
      await row().getByText("Change role").click();
      await row().getByLabel(`Role for ${QA.name}`).selectOption("developer");
      await row().getByRole("button", { name: "Save role" }).click();
      await page.getByText("Role changed.").waitFor();
      expect(q<{ role: string }>("SELECT role FROM users WHERE email = ?", QA.email)[0].role).toBe("developer");
      await other.goto(`${APP}/`);
      await other.waitForURL(/\/login/); // signed out by the role change

      await page.reload();
      await row().getByRole("button", { name: "Disable" }).click();
      await row().getByRole("button", { name: "Enable" }).waitFor();
      await signIn(QA.password);
      expect(other.url()).toContain("/login"); // disabled accounts can't sign in
      await row().getByRole("button", { name: "Enable" }).click();
      await row().getByRole("button", { name: "Disable" }).waitFor();

      await row().getByText("Reset password").click();
      await row().getByLabel(`New password for ${QA.name}`).fill("a brand new password 123");
      await row().getByRole("button", { name: "Reset" }).click();
      await page.getByText(/password/i).first().waitFor();
      await signIn("a brand new password 123");
      await other.waitForURL(`${APP}/`);
      // The admin's own row has no role/disable controls (the last admin can't lock themselves out).
      expect(await page.locator("li", { hasText: ADMIN.email }).getByText("Change role").count()).toBe(0);
      // Restore the original password and role for later tests.
      await page.reload();
      await row().getByText("Reset password").click();
      await row().getByLabel(`New password for ${QA.name}`).fill(QA.password);
      await row().getByRole("button", { name: "Reset" }).click();
      await page.waitForTimeout(500);
      await row().getByText("Change role").click();
      await row().getByLabel(`Role for ${QA.name}`).selectOption("qa");
      await row().getByRole("button", { name: "Save role" }).click();
      await page.getByText("Role changed.").waitFor();
      await ctx.close();
    });

    it("UX 4: Help explains the workflow and terms; New Audit keeps advanced settings out of the way", async () => {
      await page.goto(`${APP}/help`);
      expect(await page.getByRole("heading", { name: "Help & getting started" }).count()).toBe(1);
      expect(await page.getByText("Words you'll see").count()).toBe(1);
      await page.goto(`${APP}/audits/new?project=${projectId}`);
      expect(await page.getByLabel("Maximum pages").isVisible()).toBe(false);
      expect(await page.getByTestId("settings-summary").innerText()).toMatch(/Up to \d+ pages/);
      await page.getByText("Advanced settings (optional)").click();
      expect(await page.getByLabel("Maximum pages").isVisible()).toBe(true);
    });
  });

  it("UI audit: no page scrolls sideways at 320–1440px, and the app has no critical/serious axe violations", async () => {
    const { AxeBuilder } = await import("@axe-core/playwright");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const issueId = issueUrl.split("/").pop();
    const routes = [
      "/", "/projects", `/projects/${projectId}`, `/audits/new?project=${projectId}`, "/audits", `/audits/${runId}`,
      "/issues", `/issues/${issueId}`, `/reports?run=${runId}`, "/approvals", `/reaudit?project=${projectId}`,
      `/google?project=${projectId}`, `/google/pagespeed?project=${projectId}`, `/google/structured-data?project=${projectId}`,
      `/google/connections?project=${projectId}`, "/settings", "/help", `/review?run=${runId}`,
    ];
    const overflow: string[] = [];
    const a11y: { route: string; id: string; impact: string; nodes: number; help: string }[] = [];
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const r of routes) {
        await page.goto(`${APP}${r}`);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        if (sw > width + 1) {
          const culprit = await page.evaluate((w) => {
            const out: string[] = [];
            for (const el of document.querySelectorAll("body *")) {
              const r = el.getBoundingClientRect();
              if (r.right <= w + 1 || r.width === 0) continue;
              let p = el.parentElement, inside = false;
              while (p) { if (getComputedStyle(p).overflowX !== "visible") { inside = true; break; } if (p.getBoundingClientRect().right > w + 1) { inside = true; break; } p = p.parentElement; }
              if (!inside) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join(".")} (${Math.round(r.right)}px)`);
            }
            return out.slice(0, 3).join("; ");
          }, width);
          overflow.push(`${r} @ ${width}px: page is ${sw}px wide · ${culprit}`);
        }
        if (width === 1440 || width === 390) {
          const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
          for (const v of res.violations) a11y.push({ route: `${r} @ ${width}px`, id: v.id, impact: v.impact ?? "", nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} :: ${(n.failureSummary ?? "").split(String.fromCharCode(10)).slice(1, 2).join("").trim().slice(0, 120)}`) } as never);
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/ui-audit.json", JSON.stringify({ overflow, a11y }, null, 2));
    expect(overflow).toEqual([]);
    expect(a11y.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  }, 600_000);

  it("Test 14: the audited website only ever received read-only requests", () => {
    expect(site.requests.length).toBeGreaterThan(10);
    const methods = new Set(site.requests.map((r) => r.method));
    expect([...methods].every((m) => m === "GET" || m === "HEAD")).toBe(true);
  });
});
