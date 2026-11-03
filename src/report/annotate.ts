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
</style></head><body><div id="wrap"><img id="img"></div><script>
const d = JSON.parse(decodeURIComponent(location.hash.slice(1)));
const img = document.getElementById("img");
img.onload = () => {
  for (const b of d.boxes) {
    const el = document.createElement("div"); el.className = "box";
    const w = Math.min(b.w, img.naturalWidth - b.x);
    Object.assign(el.style, { left: b.x + "px", top: b.y + "px", width: Math.max(2, w) + "px", height: Math.max(2, b.h) + "px" });
    document.getElementById("wrap").appendChild(el);
  }
  window.__dims = { w: img.naturalWidth, h: img.naturalHeight };
};
img.onerror = () => { window.__dims = { w: 0, h: 0 }; };
img.src = d.img;
</script></body></html>`;

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
      const data = { img: pathToFileURL(join(runDir, shot.path)).href, boxes: issue.evidence.boxes };
      await page.setViewportSize({ width: Math.max(shot.viewport, 320), height: 900 });
      // A hash-only change would not reload the helper page, so start fresh for every issue.
      await page.goto("about:blank");
      await page.goto(pathToFileURL(helperPath).href + "#" + encodeURIComponent(JSON.stringify(data)));
      await page.waitForFunction("window.__dims", null, { timeout: 10_000 }).catch(() => {});
      const dims = (await page.evaluate("window.__dims")) as { w: number; h: number } | undefined;
      if (!dims?.h) continue;
      const top = Math.min(...issue.evidence.boxes.map((b) => b.y));
      const bottom = Math.max(...issue.evidence.boxes.map((b) => b.y + b.h));
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
