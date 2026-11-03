import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { exportsDir } from "../server/db";
import { exportById, markExport } from "../server/exports";
import { loadReportData } from "../server/reporting/data";
import { buildXlsx } from "../server/reporting/xlsx";
import { buildReportHtml, featured } from "../server/reporting/html";
import { launchBrowser } from "../src/capture/browser";

const MIME_EXT = { xlsx: "xlsx", pdf: "pdf", html: "html", json: "json" } as const;

/** Annotated crops of the featured findings, inlined as data URIs (reports must be self-contained). */
async function evidenceImages(runDir: string | null, paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!runDir) return map;
  const root = resolve(runDir) + sep;
  for (const p of paths.slice(0, 20)) {
    const full = resolve(runDir, p);
    if (!full.startsWith(root)) continue;
    const data = await readFile(full).catch(() => null);
    if (data) map.set(p, `data:image/png;base64,${data.toString("base64")}`);
  }
  return map;
}

async function renderPdf(html: string, footer: string): Promise<Buffer> {
  const browser = await launchBrowser(process.env.WEBAUDIT_BROWSER_CHANNEL ?? "msedge");
  try {
    const page = await browser.newPage();
    // Offline render: the report is self-contained, so block any network access.
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:8px;width:100%;padding:0 16mm;color:#667085;display:flex;justify-content:space-between">
        <span>${footer.replace(/[<>&]/g, "")}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: "16mm", bottom: "18mm", left: "0", right: "0" },
    });
  } finally {
    await browser.close();
  }
}

export async function processExport(exportId: string, log: (m: string) => void): Promise<"completed" | "failed"> {
  const exp = exportById(exportId);
  if (!exp) return "failed";
  markExport(exportId, { status: "running" });
  try {
    const d = loadReportData(exp);
    const slug = d.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "audit";
    const fileName = `${slug}-audit-${d.run.created_at.slice(0, 10)}.${MIME_EXT[exp.format]}`;
    let body: Buffer | string;

    if (exp.format === "xlsx") {
      body = await buildXlsx(d);
    } else if (exp.format === "json") {
      body = JSON.stringify({
        generatedAt: d.generatedAt, generatedBy: d.generatedBy, filters: d.filters, project: d.project,
        run: { id: d.run.id, startUrl: d.run.start_url, createdAt: d.run.created_at, finishedAt: d.run.finished_at, settings: d.run.settings, summary: d.run.summary },
        pages: d.pages, score: d.score, google: d.google,
        issues: d.issues.map(({ evidence, ...i }) => ({ ...i, evidence: { ...evidence, viewUrl: `${d.appUrl}/issues/${i.id}` } })),
      }, null, 2);
    } else {
      const imgs = await evidenceImages(d.run.run_dir, featured(d).items.map((i) => i.evidence.annotated).filter((p): p is string => !!p));
      const html = buildReportHtml(d, imgs);
      body = exp.format === "html" ? html : await renderPdf(html, `${d.brand} · ${d.project.name} · ${d.run.created_at.slice(0, 10)}`);
    }

    await mkdir(exportsDir(), { recursive: true });
    const filePath = join(exportsDir(), `${exportId}.${MIME_EXT[exp.format]}`);
    await writeFile(filePath, body);
    markExport(exportId, { status: "completed", file_path: filePath, file_name: fileName, size_bytes: Buffer.byteLength(body), issue_count: d.issues.length });
    log(`Export ${exportId} (${exp.format}) written: ${d.issues.length} findings`);
    return "completed";
  } catch (e) {
    markExport(exportId, { status: "failed", error: (e as Error).message.split("\n")[0] });
    return "failed";
  }
}
