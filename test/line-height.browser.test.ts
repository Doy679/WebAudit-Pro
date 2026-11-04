// BUG-25 (retest): the engine's own extraction script, in a real browser, converts every kind of line-height
// to the pixel value the browser actually uses. Shows that "0.10 (1.4px on 14px text)" is a faithful reading.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import type { Browser } from "playwright";
import { launchBrowser } from "../src/capture/browser";

const EXTRACT = readFileSync("src/capture/extract.browser.js", "utf8");
let browser: Browser;

beforeAll(async () => { browser = await launchBrowser(process.env.WEBAUDIT_BROWSER_CHANNEL ?? "msedge"); }, 60_000);
afterAll(async () => { await browser?.close(); });

describe("line-height conversion (real browser)", () => {
  it("normal, %, unitless, px and inherited values all become the rendered px value", async () => {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><body style="font-family: Arial">
      <p id="normal" style="font-size:20px;line-height:normal">Normal line height text</p>
      <p style="font-size:14px;line-height:150%">Percent line height text</p>
      <p style="font-size:14px;line-height:1.5">Unitless line height text</p>
      <p style="font-size:14px;line-height:21px">Pixel line height text</p>
      <div style="font-size:10px;line-height:2"><p style="font-size:14px">Inherited unitless factor text</p></div>
      <div style="font-size:10px;line-height:20px"><p style="font-size:14px">Inherited pixel value text</p></div>
      <div style="font-size:10px;line-height:150%"><p style="font-size:14px">Inherited percent value text</p></div>
      <p style="font-size:14px;line-height:0.1">Tiny line height text</p>
    </body>`);
    const data = (await page.evaluate(EXTRACT)) as { elements: { text?: string; css: { fontSize?: number; lineHeight?: number } }[] };
    const lh = (start: string) => data.elements.find((e) => e.text?.startsWith(start))?.css.lineHeight;
    expect(lh("Normal")).toBe(24); // engine estimate for "normal": 1.2 × font size
    expect(lh("Percent")).toBe(21);
    expect(lh("Unitless")).toBe(21);
    expect(lh("Pixel")).toBe(21);
    expect(lh("Inherited unitless")).toBe(28); // the factor is inherited, applied to the child's 14px
    expect(lh("Inherited pixel")).toBe(20); // a px value is inherited as-is
    expect(lh("Inherited percent")).toBe(15); // a % is computed on the parent (10px × 150%) and inherited as px
    expect(lh("Tiny")).toBe(1.4); // the retest value is what the browser really uses
    await page.close();
  }, 60_000);
});
