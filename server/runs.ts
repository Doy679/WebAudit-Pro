import { all, get, run, newId, now, tx } from "./db";
import type { User } from "./auth";
import { assertCan, assertProjectAccess, NotFoundError, projectScope } from "./permissions";
import { getProject, isInScope } from "./projects";
import { assertPublicUrl, envPolicy } from "../src/security/ssrf";
import type { Issue } from "../src/types";
import type { SdResult } from "../src/schema/types";

export const DEFAULT_VIEWPORTS = [320, 390, 768, 1024, 1440];
export const MAX_PAGES_LIMIT = 200;

export interface RunSettings {
  startUrl: string;
  maxPages?: number;
  useSitemap?: boolean;
  urls?: string[];
  viewports?: number[];
  categories?: string[];
  delayMs?: number;
  /** Optional Google steps queued after the crawl completes (external services; never automatic for every URL). */
  google?: { psiMobile?: boolean; psiDesktop?: boolean; psiMaxUrls?: number; gscPerformance?: boolean; gscSitemaps?: boolean; inspectMaxUrls?: number };
}

export interface AuditRun {
  id: string;
  project_id: string;
  project_name?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  start_url: string;
  settings: RunSettings;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  cancel_requested: number;
  phase: string | null;
  error: string | null;
  pages_total: number;
  pages_done: number;
  pages_failed: number;
  pages_skipped: number;
  findings_raw: number;
  findings: number;
  current_url: string | null;
  current_viewport: number | null;
  run_dir: string | null;
  summary: Record<string, unknown> | null;
}

type RunRow = Omit<AuditRun, "settings" | "summary"> & { settings_json: string; summary_json: string | null };
const toRun = (r: RunRow): AuditRun => {
  const { settings_json, summary_json, ...rest } = r;
  return { ...rest, settings: JSON.parse(settings_json), summary: summary_json ? JSON.parse(summary_json) : null };
};

/** Validates and normalizes audit settings against the project's authorized scope. */
export function normalizeSettings(projectDomain: string, s: RunSettings): RunSettings {
  const scope = { domain: projectDomain };
  if (!isInScope(scope, s.startUrl)) throw new Error(`That URL is outside this project's authorized domain (${projectDomain}).`);
  const urls = (s.urls ?? []).map((u) => u.trim()).filter(Boolean);
  const outside = urls.filter((u) => !isInScope(scope, u));
  if (outside.length) throw new Error(`These URLs are outside the authorized domain: ${outside.slice(0, 3).join(", ")}`);
  const viewports = [...new Set((s.viewports?.length ? s.viewports : DEFAULT_VIEWPORTS).map(Number))]
    .filter((v) => Number.isInteger(v) && v >= 240 && v <= 2560).sort((a, b) => a - b);
  if (!viewports.length) throw new Error("Choose at least one viewport width between 240 and 2560px.");
  const maxPages = Math.min(Math.max(1, Math.floor(s.maxPages ?? 20)), MAX_PAGES_LIMIT);
  const delayMs = Math.min(Math.max(500, Math.floor(s.delayMs ?? 1000)), 10_000); // never faster than 2 page loads/second
  const g = s.google;
  const google = g && (g.psiMobile || g.psiDesktop || g.gscPerformance || g.gscSitemaps || (g.inspectMaxUrls ?? 0) > 0)
    ? {
        psiMobile: !!g.psiMobile, psiDesktop: !!g.psiDesktop, psiMaxUrls: Math.min(Math.max(Math.floor(g.psiMaxUrls ?? 5), 1), 50),
        gscPerformance: !!g.gscPerformance, gscSitemaps: !!g.gscSitemaps, inspectMaxUrls: Math.min(Math.max(Math.floor(g.inspectMaxUrls ?? 0), 0), 200),
      }
    : undefined;
  return { startUrl: s.startUrl, maxPages, useSitemap: s.useSitemap ?? true, urls, viewports, categories: s.categories, delayMs, google };
}

/** Creates a pending run and queues its job (no network checks; see createAuditRun). */
export function insertRun(user: User, projectId: string, settings: RunSettings): string {
  assertCan(user, "audit:start");
  const project = getProject(user, projectId);
  const normalized = normalizeSettings(project.domain, settings);
  const id = newId();
  const ts = now();
  tx(() => {
    run(`INSERT INTO audit_runs (id, project_id, status, start_url, settings_json, created_by, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
      id, projectId, normalized.startUrl, JSON.stringify(normalized), user.id, ts);
    run("INSERT INTO jobs (id, type, ref_id, status, created_at) VALUES (?, 'audit', ?, 'pending', ?)", newId(), id, ts);
  });
  return id;
}

/** Full validation (permissions, scope, SSRF) then queues the audit. */
export async function createAuditRun(user: User, projectId: string, settings: RunSettings): Promise<string> {
  assertCan(user, "audit:start");
  const project = getProject(user, projectId);
  normalizeSettings(project.domain, settings);
  await assertPublicUrl(settings.startUrl, envPolicy());
  return insertRun(user, projectId, settings);
}

export function getRun(user: User, id: string): AuditRun {
  const row = get<RunRow>("SELECT * FROM audit_runs WHERE id = ?", id);
  if (!row) throw new NotFoundError("Audit run not found.");
  assertProjectAccess(user, row.project_id);
  return toRun(row);
}

export function listRuns(user: User, opts: { projectId?: string; status?: string; limit?: number } = {}): AuditRun[] {
  const scope = projectScope(user, "r.project_id");
  const where = [scope.sql];
  const params: unknown[] = [...scope.params];
  if (opts.projectId) { where.push("r.project_id = ?"); params.push(opts.projectId); }
  if (opts.status) { where.push("r.status = ?"); params.push(opts.status); }
  return all<RunRow & { project_name: string }>(
    `SELECT r.*, p.name AS project_name FROM audit_runs r JOIN projects p ON p.id = r.project_id
     WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC LIMIT ?`, ...params, opts.limit ?? 100,
  ).map(toRun);
}

export function requestCancel(user: User, runId: string) {
  assertCan(user, "audit:cancel");
  const r = getRun(user, runId);
  if (r.status === "pending") {
    tx(() => {
      run("UPDATE audit_runs SET status = 'cancelled', cancel_requested = 1, finished_at = ?, phase = 'cancelled' WHERE id = ?", now(), runId);
      run("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE ref_id = ? AND status = 'pending'", now(), runId);
    });
  } else if (r.status === "running") {
    run("UPDATE audit_runs SET cancel_requested = 1 WHERE id = ?", runId);
  }
}

export const isCancelRequested = (runId: string) =>
  !!get<{ c: number }>("SELECT cancel_requested AS c FROM audit_runs WHERE id = ?", runId)?.c;

export interface Job { id: string; type: "audit" | "export"; ref_id: string }

/** Atomically claims the oldest pending job of a type (safe with several workers). */
export function claimNextJob(type: Job["type"]): Job | undefined {
  return tx(() => {
    const job = get<Job>("SELECT id, type, ref_id FROM jobs WHERE type = ? AND status = 'pending' ORDER BY created_at LIMIT 1", type);
    if (!job) return undefined;
    run("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?", now(), job.id);
    if (type === "audit") run("UPDATE audit_runs SET status = 'running', started_at = ?, heartbeat_at = ?, phase = 'starting' WHERE id = ?", now(), now(), job.ref_id);
    return job;
  });
}

export function finishJob(jobId: string, status: "completed" | "failed" | "cancelled", error?: string) {
  run("UPDATE jobs SET status = ?, finished_at = ?, error = ? WHERE id = ?", status, now(), error ?? null, jobId);
}

export function updateProgress(runId: string, p: {
  phase?: string; pagesTotal?: number; pagesDone?: number; pagesFailed?: number; pagesSkipped?: number;
  currentUrl?: string | null; currentViewport?: number | null; findings?: number;
}) {
  run(`UPDATE audit_runs SET heartbeat_at = ?, phase = COALESCE(?, phase), pages_total = COALESCE(?, pages_total), pages_done = COALESCE(?, pages_done),
       pages_failed = COALESCE(?, pages_failed), pages_skipped = COALESCE(?, pages_skipped), current_url = ?, current_viewport = ?,
       findings_raw = COALESCE(?, findings_raw) WHERE id = ?`,
    now(), p.phase ?? null, p.pagesTotal ?? null, p.pagesDone ?? null, p.pagesFailed ?? null, p.pagesSkipped ?? null,
    p.currentUrl ?? null, p.currentViewport ?? null, p.findings ?? null, runId);
}

export function setRunDir(runId: string, dir: string) {
  run("UPDATE audit_runs SET run_dir = ? WHERE id = ?", dir, runId);
}

export function finishRun(runId: string, status: "completed" | "failed" | "cancelled", error?: string, summary?: unknown) {
  run(`UPDATE audit_runs SET status = ?, finished_at = ?, error = ?, phase = ?, current_url = NULL, current_viewport = NULL,
       summary_json = COALESCE(?, summary_json) WHERE id = ?`,
    status, now(), error ?? null, status, summary ? JSON.stringify(summary) : null, runId);
}

/** Runs left "running" by a worker that died are marked failed so they never look stuck. */
export function failOrphanedRuns(): number {
  const orphans = all<{ id: string }>("SELECT id FROM audit_runs WHERE status = 'running'");
  for (const o of orphans) {
    finishRun(o.id, "failed", "The worker stopped before this audit finished (interrupted). Start a new audit to retry.");
    run("UPDATE jobs SET status = 'failed', finished_at = ?, error = 'interrupted' WHERE ref_id = ? AND status = 'running'", now(), o.id);
  }
  run("UPDATE jobs SET status = 'pending', started_at = NULL WHERE type = 'export' AND status = 'running'");
  run("UPDATE google_tasks SET status = 'pending', started_at = NULL WHERE status = 'running'");
  return orphans.length;
}

/** Stores the engine's grouped findings. Earlier false-positive decisions on the same fingerprint carry over. */
export function importResults(
  runId: string,
  issues: Issue[],
  pages: { url: string; ok: boolean; status: number; error?: string }[],
  structured: { url: string; result: SdResult }[] = [],
) {
  const projectId = get<{ project_id: string }>("SELECT project_id FROM audit_runs WHERE id = ?", runId)!.project_id;
  const ts = now();
  tx(() => {
    for (const p of pages) {
      run("INSERT OR REPLACE INTO run_pages (run_id, url, ok, status, error) VALUES (?, ?, ?, ?, ?)", runId, p.url, p.ok ? 1 : 0, p.status, p.error ?? null);
    }
    for (const i of issues) {
      const prior = get<{ id: string; notes: string }>(
        `SELECT id, notes FROM issues WHERE project_id = ? AND fingerprint = ? AND verification_status = 'false_positive' AND run_id != ?
         ORDER BY updated_at DESC LIMIT 1`, projectId, i.fingerprint, runId);
      const id = newId();
      run(`INSERT INTO issues (id, run_id, project_id, code, fingerprint, type, rule, kind, severity, confidence, title, url, pages_json, viewports_json,
             selector, elementor_id, shared_template, instance_count, current_value, proposed_value, recommendation, evidence_json, occurrences_json,
             captured_at, verification_status, notes, updated_at, provider)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, runId, projectId, i.id, i.fingerprint, i.type, i.rule, i.kind, i.severity, i.confidence, i.title, i.location.url,
        JSON.stringify(i.location.pages), JSON.stringify(i.location.viewports), i.location.selector ?? null, i.location.elementorId ?? null,
        i.sharedTemplate ? 1 : 0, i.instanceCount, i.current ?? null, i.proposed ?? null, i.recommendation, JSON.stringify(i.evidence),
        JSON.stringify(i.occurrences.slice(0, 200)), i.evidence.capturedAt,
        prior ? "false_positive" : "unverified", prior ? `Marked false positive in an earlier audit. ${prior.notes}`.trim() : "", ts,
        i.type === "structured-data" ? "schema" : "webaudit");
      if (prior) {
        run(`INSERT INTO issue_events (id, issue_id, user_id, actor_label, action, from_value, to_value, note, created_at)
             VALUES (?, ?, NULL, 'System', 'false_positive', 'unverified', 'false_positive', 'Carried over from an earlier audit of this project', ?)`, newId(), id, ts);
      }
    }
    for (const s of structured) {
      const all = s.result.items.flatMap((i) => i.issues);
      run(`INSERT OR REPLACE INTO structured_data (run_id, project_id, url, items_json, errors, warnings, rules_version, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        runId, projectId, s.url, JSON.stringify(s.result.items), all.filter((x) => x.severity === "error").length, all.filter((x) => x.severity === "warning").length, s.result.rulesVersion, ts);
    }
    run("UPDATE audit_runs SET findings = ? WHERE id = ?", issues.length, runId);
  });
}

export function runPages(runId: string) {
  return all<{ url: string; ok: number; status: number; error: string | null }>("SELECT url, ok, status, error FROM run_pages WHERE run_id = ? ORDER BY url", runId);
}
