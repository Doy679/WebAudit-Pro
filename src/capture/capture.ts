import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext } from "playwright";
import { launchBrowser } from "./browser.js";
import { AxeBuilder } from "@axe-core/playwright";
import type { ElementSnapshot, PageSnapshot, Tokens } from "../types.js";
import type { AxeLike } from "../checks/a11y.js";
import { HostGuard, type SsrfPolicy } from "../security/ssrf.js";

const EXTRACT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "extract.browser.js"), "utf8");
// Applied to our own headless copy only, so screenshots are stable. Never touches the live site.
const FREEZE_CSS = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CaptureResult {
  snapshot: PageSnapshot;
  axe?: AxeLike;
  error?: string;
}

export class Capturer {
  private browser?: Browser;
  private contexts = new Map<number, BrowserContext>();
  private delayMs: number;
  private lastRequest = 0;

  private guard: HostGuard;
  /** Requests aborted because they targeted a private/internal address. */
  blockedRequests = 0;

  constructor(private tokens: Tokens, private runDir: string, policy: SsrfPolicy = {}) {
    this.delayMs = tokens.crawl.delayMs;
    this.guard = new HostGuard(policy);
  }

  async start() {
    this.browser = await launchBrowser(this.tokens.crawl.browserChannel);
  }

  async close() {
    await this.browser?.close();
  }

  private async context(viewport: number): Promise<BrowserContext> {
    let ctx = this.contexts.get(viewport);
    if (ctx) return ctx;
    const mobile = viewport <= this.tokens.tapTargetMobileMaxViewport;
    ctx = await this.browser!.newContext({
      viewport: { width: viewport, height: mobile ? 844 : 900 },
      // No isMobile emulation: on overflowing pages it zooms out and re-lays the page wider,
      // which would distort every measurement. A resized window matches responsive QA practice.
      hasTouch: mobile,
      deviceScaleFactor: 1,
      userAgent: this.tokens.crawl.userAgent,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    // Read-only guardrail: any non-GET/HEAD request (forms, analytics beacons, XHR posts) is aborted.
    // SSRF guardrail: every request (page, assets, redirects) must resolve to a public address.
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      if (!["GET", "HEAD"].includes(req.method())) return route.abort();
      if (!(await this.guard.allows(req.url()))) {
        this.blockedRequests++;
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    this.contexts.set(viewport, ctx);
    return ctx;
  }

  /** Polite pacing: at most one page load per delayMs. */
  private async pace() {
    const wait = this.lastRequest + this.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequest = Date.now();
  }

  async capture(url: string, viewport: number, slug: string, runAxe: boolean): Promise<CaptureResult> {
    const { pageTimeoutMs, retries, maxScreenshotHeight } = this.tokens.crawl;
    const ctx = await this.context(viewport);
    const page = await ctx.newPage();
    const capturedAt = new Date().toISOString();
    const screenshot = `screenshots/${slug}/${viewport}.png`;
    const empty = (status: number, error?: string): CaptureResult => ({
      snapshot: { url, viewport, capturedAt, screenshot: "", docWidth: 0, docHeight: 0, meta: { status, finalUrl: url, h1Count: 0 }, elements: [] },
      error,
    });

    try {
      let status = 0;
      let lastError = "";
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(this.delayMs * 2 ** attempt);
        await this.pace();
        try {
          const res = await page.goto(url, { waitUntil: "load", timeout: pageTimeoutMs });
          status = res?.status() ?? 0;
          if (status === 429) this.delayMs *= 2;
          if (status < 500 && status !== 429) break;
          lastError = `HTTP ${status}`;
        } catch (e) {
          lastError = (e as Error).message.split("\n")[0];
          status = 0;
        }
      }
      if (status === 0) return empty(0, lastError);
      if (!(await this.guard.allows(page.url()))) return empty(0, "Redirected to a private or internal address; page not audited.");

      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
      // Scroll through once so lazy-loaded images and sections render, then return to top.
      await page.evaluate(`(async () => {
        const step = window.innerHeight;
        for (let y = 0; y < Math.min(document.body.scrollHeight, ${maxScreenshotHeight}); y += step) {
          window.scrollTo(0, y); await new Promise(r => setTimeout(r, 100));
        }
        window.scrollTo(0, 0);
      })()`).catch(() => {});
      await sleep(300);

      const data = (await page.evaluate(EXTRACT)) as Omit<PageSnapshot, "url" | "viewport" | "capturedAt" | "screenshot" | "meta"> & {
        meta: Omit<PageSnapshot["meta"], "status" | "finalUrl">;
      };

      let axe: AxeLike | undefined;
      if (runAxe && status < 400) {
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        axe = { violations: results.violations, incomplete: results.incomplete };
        // Add boxes for axe targets so issues can point at them on the screenshot.
        const targets = [...axe.violations, ...axe.incomplete].flatMap((r) => r.nodes.map((n) => n.target.map(String).join(" ")));
        const boxes = (await page.evaluate(
          `(${JSON.stringify(targets)}).map(s => { try { const el = document.querySelector(s); if (!el) return null;
            const r = el.getBoundingClientRect(); return { s, x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; } catch { return null; } })`,
        )) as ({ s: string; x: number; y: number; w: number; h: number } | null)[];
        const known = new Set(data.elements.map((e) => e.selector));
        for (const b of boxes) {
          if (!b || known.has(b.s)) continue;
          known.add(b.s);
          data.elements.push({ selector: b.s, tag: "", role: "other", box: { x: b.x, y: b.y, w: b.w, h: b.h }, css: {} } satisfies ElementSnapshot);
        }
      }

      const path = join(this.runDir, screenshot);
      await mkdir(dirname(path), { recursive: true });
      const height = Math.min(data.docHeight || 900, maxScreenshotHeight);
      await page.screenshot({ path, fullPage: true, clip: { x: 0, y: 0, width: viewport, height } });

      return {
        snapshot: {
          url,
          viewport,
          capturedAt,
          screenshot,
          docWidth: data.docWidth,
          docHeight: data.docHeight,
          meta: { ...data.meta, status, finalUrl: page.url() },
          elements: data.elements,
        },
        axe,
      };
    } catch (e) {
      return empty(0, (e as Error).message.split("\n")[0]);
    } finally {
      await page.close();
    }
  }
}

export async function saveSnapshot(runDir: string, slug: string, snap: PageSnapshot) {
  const path = join(runDir, "snapshots", slug, `${snap.viewport}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(snap, null, 2));
}
