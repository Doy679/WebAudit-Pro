import { all, get, run, newId, now, tx } from "./db";
import type { User } from "./auth";
import { assertCan, assertProjectAccess, NotFoundError, projectScope } from "./permissions";
import { getProject } from "./projects";
import { assertUrlInProjectScope, type ScopeProject } from "./scope";
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
  cancelled_by?: string | null;
  cancelled_by_name?: string | null;
}

type RunRow = Omit<AuditRun, "settings" | "summary"> & { settings_json: string; summary_json: string | null };
const toRun = (r: RunRow): AuditRun => {
  const { settings_json, summary_json, ...rest } = r;
  return { ...rest, settings: JSON.parse(settings_json), summary: summary_json ? JSON.parse(summary_json) : null };
};

/** Validates and normalizes audit settings against the project's authorized scope. */
export function normalizeSettings(project: ScopeProject, s: RunSettings): RunSettings {
  if (!s.startUrl?.trim()) throw new Error("Enter the website URL to audit.");
  assertUrlInProjectScope(project, s.startUrl.trim());
  const urls = (s.urls ?? []).map((u) => u.trim()).filter(Boolean);
  for (const u of urls) assertUrlInProjectScope(project, u);
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
  return { startUrl: s.startUrl.trim(), maxPages, useSitemap: s.useSitemap ?? true, urls, viewports, categories: s.categories, delayMs, google };
}

/** Creates a pending run and queues its job (no network checks; see createAuditRun). */
export function insertRun(user: User, projectId: string, settings: RunSettings): string {
  assertCan(user, "audit:start");
  const project = getProject(user, projectId);
  const normalized = normalizeSettings(project, settings);
  const id = newId();
  const ts = now();
  tx(() => {
    run(`INSERT INTO audit_runs (id, project_id, status, start_url, settings_json, created_by, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
      id, projectId, normalized.startUrl, JSON.stringify(normalized), user.id, ts);
    run("INSERT INTO jobs (id, type, ref_id, status, created_at) VALUES (?, 'audit', ?, 'pending', ?)", newId(), id, ts);
  });
  return id;
}

export class ActiveAuditError extends Error {
  constructor(public runId: string) {
    super("An audit of this project is already queued or running. Open it to follow its progress, or cancel it before starting another.");
  }
}

/** Full validation (permissions, project scope, SSRF, no duplicate active audit) then queues the audit. */
export async function createAuditRun(user: User, projectId: string, settings: RunSettings): Promise<string> {
  assertCan(user, "audit:start");
  const project = getProject(user, projectId); // read from the database and access-checked; the form is never trusted
  normalizeSettings(project, settings);
  const active = get<{ id: string }>("SELECT id FROM audit_runs WHERE project_id = ? AND status IN ('pending','running') ORDER BY created_at LIMIT 1", projectId);
  if (active) throw new ActiveAuditError(active.id);
  await assertPublicUrl(settings.startUrl.trim(), envPolicy());
  return insertRun(user, projectId, settings);
}

/** Number of audits that will run before this pending one (0 = next). */
export function queuePosition(runId: string): number {
  const job = get<{ created_at: string }>("SELECT created_at FROM jobs WHERE ref_id = ? AND type = 'audit' AND status = 'pending'", runId);
  if (!job) return 0;
  return get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM jobs WHERE type = 'audit' AND (status = 'running' OR (status = 'pending' AND created_at < ?))", job.created_at)!.n;
}

export function getRun(user: User, id: string): AuditRun {
  const row = get<RunRow>("SELECT r.*, p.name AS project_name, u.name AS cancelled_by_name FROM audit_runs r JOIN projects p ON p.id = r.project_id LEFT JOIN users u ON u.id = r.cancelled_by WHERE r.id = ?", id);
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
    `SELECT r.*, p.name AS project_name, u.name AS cancelled_by_name FROM audit_runs r JOIN projects p ON p.id = r.project_id
     LEFT JOIN users u ON u.id = r.cancelled_by
     WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC LIMIT ?`, ...params, opts.limit ?? 100,
  ).map(toRun);
}

export function requestCancel(user: User, runId: string) {
  assertCan(user, "audit:cancel");
  const r = getRun(user, runId);
  if (r.status === "pending") {
    tx(() => {
      run("UPDATE audit_runs SET status = 'cancelled', cancel_requested = 1, cancelled_by = ?, finished_at = ?, phase = 'cancelled' WHERE id = ?", user.id, now(), runId);
      run("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE ref_id = ? AND status = 'pending'", now(), runId);
    });
  } else if (r.status === "running") {
    run("UPDATE audit_runs SET cancel_requested = 1, cancelled_by = ? WHERE id = ?", user.id, runId);
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
    run("UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1 WHERE id = ?", now(), job.id);
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

const MAX_ATTEMPTS = 3;

/**
 * Called when the (single) worker starts. Audits left "running" by a worker that died are requeued and restart
 * from scratch (findings are only imported at the end, so nothing is duplicated). After repeated interruptions
 * they are marked failed instead of looping forever. Pending cancel requests are honoured.
 */
export function recoverOrphanedRuns(): { requeued: number; failed: number } {
  let requeued = 0, failed = 0;
  const orphans = all<{ id: string; cancel_requested: number; attempts: number | null; job_id: string | null }>(
    `SELECT r.id, r.cancel_requested, j.attempts, j.id AS job_id FROM audit_runs r LEFT JOIN jobs j ON j.ref_id = r.id AND j.type = 'audit'
     WHERE r.status = 'running'`);
  for (const o of orphans) {
    if (o.cancel_requested) {
      finishRun(o.id, "cancelled", "Cancelled by a user (the worker stopped before it finished cancelling).");
      run("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ?", now(), o.job_id);
    } else if (o.job_id && (o.attempts ?? MAX_ATTEMPTS) < MAX_ATTEMPTS) {
      tx(() => {
        run(`UPDATE audit_runs SET status = 'pending', phase = 'requeued', started_at = NULL, heartbeat_at = NULL, pages_total = 0, pages_done = 0,
             pages_failed = 0, pages_skipped = 0, findings_raw = 0, current_url = NULL, current_viewport = NULL, error = ? WHERE id = ?`,
          `The worker stopped during this audit; it was requeued automatically (attempt ${(o.attempts ?? 0) + 1} of ${MAX_ATTEMPTS}).`, o.id);
        run("UPDATE jobs SET status = 'pending', started_at = NULL WHERE id = ?", o.job_id);
      });
      requeued++;
    } else {
      finishRun(o.id, "failed", "The worker was interrupted repeatedly while running this audit. Check the worker logs, then start a new audit.");
      if (o.job_id) run("UPDATE jobs SET status = 'failed', finished_at = ?, error = 'interrupted' WHERE id = ?", now(), o.job_id);
      failed++;
    }
  }
  run("UPDATE jobs SET status = 'pending', started_at = NULL WHERE type = 'export' AND status = 'running'");
  run("UPDATE google_tasks SET status = 'pending', started_at = NULL WHERE status = 'running'");
  return { requeued, failed };
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
        `SELECT id, notes FROM issues WHERE project_id = ? AND fingerprint = ? AND verification_status = 'false_positive' AND duplicate_of IS NULL AND run_id != ?
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

/**
 * BUG-24 / UX-17: how long an audit is likely to take, from this installation's own finished audits
 * (median seconds per page per screen size), as a range rather than a promise.
 */
export function estimateAuditDuration(pages: number, viewports: number): { label: string; secondsPerPageView: number; basis: "history" | "default" } {
  const rates = all<{ s: number }>(
    `SELECT (julianday(finished_at) - julianday(started_at)) * 86400.0 / (pages_done * json_array_length(json_extract(settings_json, '$.viewports'))) AS s
     FROM audit_runs WHERE status = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND pages_done > 0
       AND json_array_length(json_extract(settings_json, '$.viewports')) > 0 ORDER BY created_at DESC LIMIT 20`)
    .map((r) => r.s).filter((s) => s > 0.5 && s < 120).sort((a, b) => a - b);
  const basis = rates.length ? "history" : "default";
  const rate = rates.length ? rates[Math.floor(rates.length / 2)] : 9;
  const mins = (s: number) => Math.max(1, Math.round(s / 60));
  const total = pages * viewports * rate;
  const low = mins(total * 0.85), high = mins(total * 1.15);
  return { label: `about ${low === high ? low : `${low}–${high}`} min`, secondsPerPageView: Math.round(rate * 10) / 10, basis };
}

const clock = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const span = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`);

/** BUG-21: one plain sentence explaining a cancelled audit: who, when, and what was (not) kept. */
export function cancellationNote(r: Pick<AuditRun, "status" | "started_at" | "finished_at" | "findings_raw" | "pages_done" | "cancelled_by_name">): string | null {
  if (r.status !== "cancelled") return null;
  const who = r.cancelled_by_name ? `by ${r.cancelled_by_name} ` : "";
  const when = r.finished_at ? `on ${clock(r.finished_at)}` : "";
  if (!r.started_at) return `Cancelled ${who}${when} while waiting in the queue; it never started.`;
  const ran = r.finished_at ? ` after ${span(Date.parse(r.finished_at) - Date.parse(r.started_at))}` : "";
  const kept = r.findings_raw ? ` ${r.findings_raw} raw findings collected so far were not imported.` : " No findings were imported.";
  return `Cancelled ${who}${when}${ran}.${kept}`;
}
