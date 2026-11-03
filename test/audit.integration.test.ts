import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, AuditCancelledError, type AuditResult } from "../src/audit.js";
import { startFixtureServer } from "./fixtureServer.js";
import { tokens } from "./helpers.js";
import { envPolicy, UnsafeUrlError } from "../src/security/ssrf.js";

// Real Playwright run against a local fixture site. No live sites are touched.
describe("runAudit (integration)", () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>;
  let outDir: string;
  let result: AuditResult;

  beforeAll(async () => {
    server = await startFixtureServer();
    outDir = await mkdtemp(join(tmpdir(), "webaudit-"));
    result = await runAudit({
      startUrl: server.origin + "/",
      outDir,
      tokens: { ...tokens, viewports: [390, 1440], a11yViewports: [390], crawl: { ...tokens.crawl, delayMs: 0 } },
      log: () => {},
      policy: envPolicy(),
    });
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await rm(outDir, { recursive: true, force: true });
  });

  const find = (rule: string, url = "/problems.html") =>
    result.issues.find((i) => i.rule === rule && i.location.url.endsWith(url));

  it("discovers pages from the sitemap and respects robots.txt", () => {
    expect(result.summary.pages.map((p) => new URL(p.url).pathname).sort()).toEqual(["/", "/problems.html"]);
    expect(server.requests.some((r) => r.path === "/blocked.html")).toBe(false);
  });

  it("only ever sends GET/HEAD requests", () => {
    expect(server.requests.every((r) => r.method === "GET" || r.method === "HEAD")).toBe(true);
  });

  it("detects horizontal overflow on mobile but not desktop", () => {
    const issue = find("horizontal-overflow")!;
    expect(issue).toBeDefined();
    expect(issue.location.viewports).toEqual([390]);
    expect(issue.location.selector).toContain("wide-box");
  });

  it("detects clipped text, small tap targets, wrapping buttons and placeholder links", () => {
    expect(find("text-clipped")?.location.selector).toContain("h2");
    expect(find("tap-target-small")).toBeDefined();
    expect(find("button-text-wraps")).toBeDefined();
    expect(find("placeholder-link")).toBeDefined();
  });

  it("detects small fonts, SEO problems and accessibility issues", () => {
    expect(find("font-too-small")).toBeDefined();
    expect(find("h1-missing")).toBeDefined();
    expect(find("meta-description-missing")).toBeDefined();
    expect(find("canonical-mismatch")).toBeDefined();
    expect(find("axe:color-contrast")).toBeDefined();
  });

  it("keeps the clean homepage free of confirmed layout issues", () => {
    const home = result.issues.filter((i) => new URL(i.location.url).pathname === "/" && i.kind === "confirmed" && i.type === "layout");
    expect(home).toEqual([]);
  });

  it("writes issues.json, run.json, report.html and annotated screenshots", async () => {
    const json = JSON.parse(await readFile(join(result.runDir, "issues.json"), "utf8"));
    expect(json.length).toBe(result.issues.length);
    const run = JSON.parse(await readFile(join(result.runDir, "run.json"), "utf8"));
    expect(run.pagesOk).toBe(2);
    const html = await readFile(join(result.runDir, "report.html"), "utf8");
    expect(html).toContain("horizontal-overflow");
    const shot = result.issues.find((i) => i.rule === "horizontal-overflow")!.evidence.screenshots[0].path;
    await expect(access(join(result.runDir, shot))).resolves.toBeUndefined();
  });

  it("draws a distinct annotated crop per issue", async () => {
    // Two rules on the same element at the same width legitimately share a crop, so compare distinct evidence only.
    const byEvidence = new Map<string, string>();
    for (const i of result.issues.filter((i) => i.evidence.annotated)) {
      byEvidence.set(JSON.stringify([i.evidence.screenshots[0].path, i.evidence.boxes]), i.evidence.annotated!);
    }
    const crops = [...byEvidence.values()];
    expect(crops.length).toBeGreaterThan(2);
    const bytes = await Promise.all(crops.map((c) => readFile(join(result.runDir, c), "base64")));
    expect(new Set(bytes).size).toBe(bytes.length);
  });

  it("does not attach a screenshot box to page-level findings", () => {
    const lang = result.issues.find((i) => i.rule === "axe:html-has-lang")!;
    expect(lang.evidence.boxes).toEqual([]);
    expect(lang.evidence.annotated).toBeUndefined();
  });

  it("detects broken images, broken internal links, placeholder text and misspellings", () => {
    expect(find("broken-image")?.current).toContain("missing.jpg");
    expect(find("placeholder-text")).toBeDefined();
    expect(find("suspected-misspelling")?.kind).toBe("needs-review");
    const links = result.issues.filter((i) => i.rule === "broken-internal-link").map((i) => i.current);
    expect(links.some((c) => c?.includes("/old-rates → HTTP 404"))).toBe(true);
    expect(result.summary.linksChecked).toBeGreaterThan(0);
  });

  it("validates structured data: syntax errors and missing Google-required properties", () => {
    expect(find("schema:syntax")?.kind).toBe("confirmed");
    const missing = result.issues.filter((i) => i.rule === "schema:required" && i.location.url.endsWith("/problems.html")).map((i) => i.current);
    expect(missing).toEqual(expect.arrayContaining(["startDate: missing", "location: missing"]));
    const home = result.structured.find((s) => new URL(s.url).pathname === "/")!;
    // Valid schema and a Google candidate; recommended properties (address, telephone…) are reported as warnings.
    expect(home.result.items[0]).toMatchObject({ types: ["Organization"], status: "warnings", eligibility: "candidate", googleFeature: "Organization" });
  });

  it("gives every finding a fingerprint, page list and traceable occurrences", () => {
    for (const i of result.issues) {
      expect(i.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(i.location.pages.length).toBeGreaterThan(0);
      expect(i.occurrences.length).toBeGreaterThan(0);
    }
  });

  it("records a failed page and keeps going", async () => {
    const out2 = await mkdtemp(join(tmpdir(), "webaudit-"));
    const r = await runAudit({
      startUrl: server.origin + "/",
      urls: [server.origin + "/", server.origin + "/missing-page"],
      outDir: out2,
      tokens: { ...tokens, viewports: [1440], a11yViewports: [], crawl: { ...tokens.crawl, delayMs: 0 } },
      log: () => {},
      policy: envPolicy(),
    });
    expect(r.issues.some((i) => i.rule === "http-error" && i.location.url.endsWith("/missing-page"))).toBe(true);
    expect(r.summary.pages.find((p) => p.url.endsWith("/"))?.ok).toBe(true);
    await rm(out2, { recursive: true, force: true });
  }, 120_000);

  it("reports progress and stops when cancelled", async () => {
    const out3 = await mkdtemp(join(tmpdir(), "webaudit-"));
    const seen: string[] = [];
    let captures = 0;
    await expect(runAudit({
      startUrl: server.origin + "/",
      outDir: out3,
      tokens: { ...tokens, viewports: [390, 1440], a11yViewports: [], crawl: { ...tokens.crawl, delayMs: 0 } },
      log: () => {},
      policy: envPolicy(),
      onProgress: (p) => { seen.push(p.phase); if (p.currentViewport) captures++; },
      shouldCancel: () => captures >= 2,
    })).rejects.toBeInstanceOf(AuditCancelledError);
    expect(seen).toContain("discovering");
    expect(seen).toContain("scanning");
    expect(seen).not.toContain("done");
    await rm(out3, { recursive: true, force: true });
  }, 120_000);

  it("refuses to audit loopback addresses without the test-only policy", async () => {
    await expect(runAudit({ startUrl: server.origin + "/", outDir, tokens, log: () => {}, policy: {} }))
      .rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
