import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { get } from "../server/db";
import { runsDir, dataDir } from "../server/db";
import { finishRun, importResults, isCancelRequested, setRunDir, updateProgress, type RunSettings } from "../server/runs";
import { runAudit, AuditCancelledError, type AuditProgress } from "../src/audit";
import { envPolicy } from "../src/security/ssrf";
import type { Tokens } from "../src/types";

const MAX_STORAGE_BYTES = Number(process.env.WEBAUDIT_MAX_STORAGE_GB ?? 20) * 1024 ** 3;

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/** Engine tokens = config/tokens.json, then the project's approved design standards, then this run's settings. */
export async function tokensFor(projectSettingsJson: string, settings: RunSettings): Promise<Tokens> {
  const base = JSON.parse(await readFile(resolve("config/tokens.json"), "utf8")) as Tokens;
  const project = JSON.parse(projectSettingsJson) as { tokens?: Partial<Tokens> & { spacing?: Partial<Tokens["spacing"]> } };
  const t = project.tokens ?? {};
  const pick = <T,>(v: T | undefined | null, fallback: T) => (v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v)) ? fallback : v);
  return {
    ...base,
    spacingScale: t.spacingScale?.length ? t.spacingScale : base.spacingScale,
    tapTargetMinPx: pick(t.tapTargetMinPx, base.tapTargetMinPx),
    minFontSizePx: pick(t.minFontSizePx, base.minFontSizePx),
    bodyLineHeightMin: pick(t.bodyLineHeightMin, base.bodyLineHeightMin),
    spacing: { ...base.spacing, ...(t.spacing ?? {}) },
    viewports: settings.viewports?.length ? settings.viewports : base.viewports,
    a11yViewports: base.a11yViewports.filter((v) => (settings.viewports ?? base.viewports).includes(v)).length
      ? base.a11yViewports.filter((v) => (settings.viewports ?? base.viewports).includes(v))
      : [Math.max(...(settings.viewports ?? base.viewports))],
    crawl: { ...base.crawl, delayMs: settings.delayMs ?? base.crawl.delayMs, maxPages: settings.maxPages ?? base.crawl.maxPages },
  };
}

export async function processAudit(runId: string, log: (m: string) => void): Promise<"completed" | "failed" | "cancelled"> {
  const row = get<{ settings_json: string; project_settings: string }>(
    "SELECT r.settings_json, p.settings_json AS project_settings FROM audit_runs r JOIN projects p ON p.id = r.project_id WHERE r.id = ?", runId);
  if (!row) return "failed";
  const settings = JSON.parse(row.settings_json) as RunSettings;
  const runDir = join(runsDir(), runId);
  setRunDir(runId, runDir);

  try {
    if ((await dirSize(dataDir())) > MAX_STORAGE_BYTES) {
      throw new Error(`Storage quota reached (${process.env.WEBAUDIT_MAX_STORAGE_GB ?? 20} GB in ${dataDir()}). Delete old runs or raise WEBAUDIT_MAX_STORAGE_GB.`);
    }
    const tokens = await tokensFor(row.project_settings, settings);
    let lastWrite = 0;
    let lastPhase = "";
    const onProgress = (p: AuditProgress) => {
      // Throttle DB writes, but always record phase changes immediately.
      if (p.phase === lastPhase && Date.now() - lastWrite < 400) return;
      lastPhase = p.phase;
      lastWrite = Date.now();
      updateProgress(runId, {
        phase: p.phase, pagesTotal: p.pagesTotal, pagesDone: p.pagesDone, pagesFailed: p.pagesFailed, pagesSkipped: p.pagesSkipped,
        currentUrl: p.currentUrl ?? null, currentViewport: p.currentViewport ?? null, findings: p.findings,
      });
    };

    const result = await runAudit({
      startUrl: settings.startUrl,
      urls: settings.urls?.length ? settings.urls : settings.useSitemap === false ? [settings.startUrl] : undefined,
      maxPages: settings.maxPages,
      outDir: runsDir(),
      runDir,
      tokens,
      categories: settings.categories?.length ? settings.categories : undefined,
      policy: envPolicy(),
      log,
      onProgress,
      shouldCancel: () => isCancelRequested(runId),
    });

    updateProgress(runId, { phase: "importing", pagesDone: result.summary.pages.length });
    importResults(runId, result.issues, result.summary.pages, result.structured);
    const summary = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
    finishRun(runId, "completed", undefined, summary);
    return "completed";
  } catch (e) {
    if (e instanceof AuditCancelledError) {
      finishRun(runId, "cancelled", "Cancelled by a user. Pages scanned so far were not imported.");
      return "cancelled";
    }
    const message = (e as Error).message?.split("\n")[0] || "Audit failed.";
    log(`Audit ${runId} failed: ${message}`);
    finishRun(runId, "failed", message);
    return "failed";
  }
}
