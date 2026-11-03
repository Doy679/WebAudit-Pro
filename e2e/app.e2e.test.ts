// End-to-end: drives the real production build (web + worker processes) with a real browser
// against a local fixture website. Requires `npm run build` first (npm run test:e2e does this).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { startFixtureServer } from "../test/fixtureServer";

const PORT = 3100;
const APP = `http://127.0.0.1:${PORT}`;
const ADMIN = { name: "E2E Admin", email: "admin@e2e.test", password: "correct horse battery staple" };
const QA = { name: "Outside QA", email: "qa@e2e.test", password: "another long password" };

let site: Awaited<ReturnType<typeof startFixtureServer>>;
let dataDir: string;
const procs: ChildProcess[] = [];
let browser: Browser;
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
  const env: NodeJS.ProcessEnv = { ...process.env, WEBAUDIT_DATA_DIR: dataDir, WEBAUDIT_TEST_ALLOW_LOOPBACK: "1", WEBAUDIT_APP_URL: APP, PORT: String(PORT), NODE_ENV: "production" };
  const p = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d: Buffer) => process.env.E2E_VERBOSE && process.stdout.write(d));
  p.stderr.on("data", (d: Buffer) => process.env.E2E_VERBOSE && process.stderr.write(d));
  procs.push(p);
  return p;
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
  site = await startFixtureServer();
  dataDir = mkdtempSync(join(tmpdir(), "webaudit-e2e-"));
  startProc([resolve("node_modules/next/dist/bin/next"), "start", "-p", String(PORT), "-H", "127.0.0.1"]);
  startProc([resolve("node_modules/tsx/dist/cli.mjs"), "worker/worker.ts"]);
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
  });

  it("Tests 4–6: opens results, the screenshot evidence and Current vs Proposed", async () => {
    await page.goto(`${APP}/issues?run=${runId}&q=Page%20scrolls`);
    await page.getByRole("link", { name: "Page scrolls sideways" }).first().click();
    await page.waitForURL(/\/issues\/[0-9a-f-]{36}$/);
    issueUrl = page.url();
    issueId = issueUrl.split("/").pop()!;

    expect(await page.getByTestId("current-value").innerText()).toMatch(/document width \d+px at 390px viewport/);
    expect(await page.getByTestId("proposed-value").innerText()).toContain("390px");
    const img = page.getByTestId("evidence-image").first();
    await img.waitFor();
    await page.waitForFunction((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0, await img.elementHandle());
    evidenceSrc = (await img.getAttribute("src"))!;
    expect(evidenceSrc).toContain(`/api/evidence/${runId}/annotated/`);
    await page.getByRole("tab", { name: "390px full page" }).click();
    expect(await page.locator("img[alt='Full-page screenshot at 390px']").count()).toBe(1);
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
    expect(wb.worksheets).toHaveLength(8);
    const ids = wb.getWorksheet("All Issues")!.getColumn(1).values.slice(2).map(String);
    expect(ids.some((id) => id.startsWith("LAY-"))).toBe(true);

    const pdfHref = (await page.getByTestId("download-pdf").first().getAttribute("href"))!;
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
  });

  it("Test 3b: cancels a running audit from the progress page", async () => {
    await page.goto(`${APP}/audits/new?project=${projectId}`);
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
    expect(await qa.getByText("No findings match these filters").count()).toBe(1);
    await qa.goto(issueUrl);
    expect(await qa.getByRole("heading", { name: "Not found" }).count()).toBe(1);
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

  it("Test 14: the audited website only ever received read-only requests", () => {
    expect(site.requests.length).toBeGreaterThan(10);
    const methods = new Set(site.requests.map((r) => r.method));
    expect([...methods].every((m) => m === "GET" || m === "HEAD")).toBe(true);
  });
});
