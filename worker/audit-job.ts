import { readFile, readdir, rm, stat } from "node:fs/promises";
import { assertUrlInProjectScope, scopePredicate, type ScopeProject } from "../server/scope";
import { join, resolve } from "node:path";
import { get } from "../server/db";
import { runsDir, dataDir } from "../server/db";
import { finishRun, importResults, isCancelRequested, setRunDir, updateProgress, type RunSettings } from "../server/runs";
import { runAudit, AuditCancelledError, type AuditProgress } from "../src/audit";
import { envPolicy } from "../src/security/ssrf";
import { queueGsc, queuePsi, presetRange } from "../server/google/service";
import type { User } from "../server/auth";
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
  const row = get<{ settings_json: string; project_settings: string; name: string; domain: string }>(
    "SELECT r.settings_json, p.settings_json AS project_settings, p.name, p.domain FROM audit_runs r JOIN projects p ON p.id = r.project_id WHERE r.id = ?", runId);
  if (!row) return "failed";
  const settings = JSON.parse(row.settings_json) as RunSettings;
  const project: ScopeProject = { name: row.name, domain: row.domain };
  const runDir = join(runsDir(), runId);
  setRunDir(runId, runDir);
  // A requeued attempt starts clean, so evidence from an interrupted attempt can't mix with this one.
  await rm(runDir, { recursive: true, force: true });

  try {
    // Defence in depth: the worker re-checks the stored URLs against the project's domain before any request.
    assertUrlInProjectScope(project, settings.startUrl);
    for (const u of settings.urls ?? []) assertUrlInProjectScope(project, u);
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
      inScope: scopePredicate(project),
      log,
      onProgress,
      shouldCancel: () => isCancelRequested(runId),
    });

    updateProgress(runId, { phase: "importing", pagesDone: result.summary.pages.length });
    importResults(runId, result.issues, result.summary.pages, result.structured);
    const summary = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
    finishRun(runId, "completed", undefined, summary);
    queueRunGoogleSteps(runId, settings, result.summary.pages, log);
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

/** Queues the optional Google steps chosen in the audit settings, as the user who started the audit. */
function queueRunGoogleSteps(runId: string, settings: RunSettings, pages: { url: string; ok: boolean }[], log: (m: string) => void) {
  const g = settings.google;
  if (!g) return;
  const r = get<{ project_id: string; created_by: string }>("SELECT project_id, created_by FROM audit_runs WHERE id = ?", runId)!;
  const user = get<User>("SELECT id, email, name, role FROM users WHERE id = ?", r.created_by)!;
  // The start page first, then the other successfully scanned pages.
  const ok = pages.filter((p) => p.ok).map((p) => p.url);
  const ordered = [...ok.filter((u) => u === settings.startUrl), ...ok.filter((u) => u !== settings.startUrl)];
  const attempt = (label: string, fn: () => unknown) => {
    try { fn(); } catch (e) { log(`Google step "${label}" not queued for ${runId}: ${(e as Error).message}`); }
  };
  const strategies = [g.psiMobile && "mobile", g.psiDesktop && "desktop"].filter(Boolean) as ("mobile" | "desktop")[];
  if (strategies.length) attempt("PageSpeed", () => queuePsi(user, r.project_id, { urls: ordered.slice(0, g.psiMaxUrls ?? 5), strategies, runId, force: true }));
  if (g.gscPerformance) attempt("Search Console performance", () => queueGsc(user, r.project_id, { kind: "performance", range: presetRange(28), runId }));
  if (g.gscSitemaps) attempt("Sitemaps", () => queueGsc(user, r.project_id, { kind: "sitemaps", runId }));
  if (g.inspectMaxUrls) attempt("URL inspection", () => queueGsc(user, r.project_id, { kind: "inspection", urls: ordered.slice(0, g.inspectMaxUrls), runId }));
}
