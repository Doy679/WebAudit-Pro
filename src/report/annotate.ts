import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser } from "../capture/browser.js";
import type { Issue } from "../types.js";

const PAD = 120;
const MAX_CROP_H = 1200;
const MIN_CROP_H = 300;
// Upper bound to keep annotation time bounded (about 0.2 s per crop); override with WEBAUDIT_MAX_ANNOTATED.
const MAX_ANNOTATED = Number(process.env.WEBAUDIT_MAX_ANNOTATED ?? 3000);

const HELPER = `<!doctype html><html><head><style>
html,body{margin:0;background:#fff}#wrap{position:relative;display:inline-block}img{display:block}
.box{position:absolute;outline:3px solid #e5484d;outline-offset:2px;background:rgba(229,72,77,.12)}
.box.tiny{border-radius:50%;outline:none;border:3px dashed #e5484d;background:rgba(229,72,77,.08)}
.cap{position:absolute;background:#e5484d;color:#fff;font:600 12px/1.3 system-ui,sans-serif;padding:2px 6px;border-radius:3px;white-space:nowrap}
</style></head><body><div id="wrap"><img id="img"></div><script>
const d = JSON.parse(decodeURIComponent(location.hash.slice(1)));
const img = document.getElementById("img");
img.onload = () => {
  for (const b of d.boxes) {
    const el = document.createElement("div"); el.className = b.tiny ? "box tiny" : "box";
    const w = Math.min(b.w, img.naturalWidth - b.x);
    Object.assign(el.style, { left: b.x + "px", top: b.y + "px", width: Math.max(2, w) + "px", height: Math.max(2, b.h) + "px" });
    document.getElementById("wrap").appendChild(el);
    if (b.tiny) {
      const cap = document.createElement("div"); cap.className = "cap";
      cap.textContent = "Element has no visible size: its position is circled";
      Object.assign(cap.style, { left: Math.min(b.x, Math.max(0, img.naturalWidth - 330)) + "px", top: (b.y + b.h + 6) + "px" });
      document.getElementById("wrap").appendChild(cap);
    }
  }
  window.__dims = { w: img.naturalWidth, h: img.naturalHeight };
};
img.onerror = () => { window.__dims = { w: 0, h: 0 }; };
img.src = d.img;
</script></body></html>`;

/**
 * BUG-19: an element smaller than 4×4 px (e.g. a broken 0×0 image) would be an invisible dot in the crop.
 * It is drawn as a 56 px ring centred on its position instead, with a caption.
 */
export function markerFor(b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number; tiny: boolean } | null {
  if (b.w >= 4 && b.h >= 4) return { ...b, tiny: false };
  if (b.w <= 0 && b.h <= 0 && b.x <= 0 && b.y <= 0) return null; // not laid out: no position to point at
  const size = 56;
  return { x: Math.max(0, Math.round(b.x + b.w / 2 - size / 2)), y: Math.max(0, Math.round(b.y + b.h / 2 - size / 2)), w: size, h: size, tiny: true };
}

/** Writes annotated/<id>.png crops (first viewport) and sets evidence.annotated. */
export async function annotate(runDir: string, issues: Issue[], browserChannel?: string): Promise<void> {
  const todo = issues.filter((i) => i.evidence.boxes.length && i.evidence.screenshots[0]?.path).slice(0, MAX_ANNOTATED);
  if (!todo.length) return;
  const helperPath = join(runDir, "_annotate.html");
  await writeFile(helperPath, HELPER);
  await mkdir(join(runDir, "annotated"), { recursive: true });
  const browser = await launchBrowser(browserChannel);
  try {
    const page = await browser.newPage();
    for (const issue of todo) {
      const shot = issue.evidence.screenshots[0];
      const boxes = issue.evidence.boxes.map(markerFor).filter((b): b is NonNullable<typeof b> => !!b);
      if (!boxes.length) continue; // nothing visible to crop around; the viewer explains why
      const data = { img: pathToFileURL(join(runDir, shot.path)).href, boxes };
      await page.setViewportSize({ width: Math.max(shot.viewport, 320), height: 900 });
      // A hash-only change would not reload the helper page, so start fresh for every issue.
      await page.goto("about:blank");
      await page.goto(pathToFileURL(helperPath).href + "#" + encodeURIComponent(JSON.stringify(data)));
      await page.waitForFunction("window.__dims", null, { timeout: 10_000 }).catch(() => {});
      const dims = (await page.evaluate("window.__dims")) as { w: number; h: number } | undefined;
      if (!dims?.h) continue;
      const top = Math.min(...data.boxes.map((b) => b.y));
      const bottom = Math.max(...data.boxes.map((b) => b.y + b.h + (b.tiny ? 30 : 0)));
      const y = Math.max(0, Math.min(top - PAD, dims.h - MIN_CROP_H));
      const height = Math.max(Math.min(bottom + PAD - y, MAX_CROP_H, dims.h - y), Math.min(MIN_CROP_H, dims.h - y));
      const out = `annotated/${issue.id}.png`;
      await page.screenshot({ path: join(runDir, out), fullPage: true, clip: { x: 0, y, width: dims.w, height } });
      issue.evidence.annotated = out;
    }
  } finally {
    await browser.close();
    await rm(helperPath, { force: true });
  }
}
