import { all, get } from "./db";
import type { User } from "./auth";
import { projectScope } from "./permissions";

/** Overview numbers for the user's projects. Findings come from each project's latest completed audit. */
export function overviewStats(user: User) {
  const p = projectScope(user, "id");
  const r = projectScope(user, "project_id");
  const latest = `SELECT (SELECT id FROM audit_runs ar WHERE ar.project_id = pr.id AND ar.status = 'completed' ORDER BY created_at DESC LIMIT 1)
                  FROM projects pr WHERE ${projectScope(user, "pr.id").sql}`;
  const latestParams = projectScope(user, "pr.id").params;
  const n = (sql: string, ...params: unknown[]) => get<{ n: number }>(sql, ...params)?.n ?? 0;
  const live = `run_id IN (${latest}) AND verification_status != 'false_positive'`;

  return {
    projects: n(`SELECT COUNT(*) AS n FROM projects WHERE ${p.sql}`, ...p.params),
    completedAudits: n(`SELECT COUNT(*) AS n FROM audit_runs WHERE status = 'completed' AND ${r.sql}`, ...r.params),
    runningAudits: n(`SELECT COUNT(*) AS n FROM audit_runs WHERE status IN ('pending','running') AND ${r.sql}`, ...r.params),
    pagesScanned: n(`SELECT COALESCE(SUM(pages_done), 0) AS n FROM audit_runs WHERE status = 'completed' AND ${r.sql}`, ...r.params),
    confirmed: n(`SELECT COUNT(*) AS n FROM issues WHERE ${live} AND kind = 'confirmed'`, ...latestParams),
    recommendations: n(`SELECT COUNT(*) AS n FROM issues WHERE ${live} AND kind = 'recommendation'`, ...latestParams),
    needsReview: n(`SELECT COUNT(*) AS n FROM issues WHERE ${live} AND kind = 'needs-review'`, ...latestParams),
    highPriority: n(`SELECT COUNT(*) AS n FROM issues WHERE ${live} AND (severity = 'high' OR priority = 'high')`, ...latestParams),
    reportsReady: n(`SELECT COUNT(*) AS n FROM exports WHERE status = 'completed' AND ${r.sql}`, ...r.params),
    // Findings released to a client (package not revoked) that have no client decision yet.
    awaitingClient: n(`SELECT COUNT(*) AS n FROM issues i WHERE i.run_id IN (${latest}) AND i.verification_status != 'false_positive'
      AND EXISTS (SELECT 1 FROM approval_items ai JOIN approval_packages ap ON ap.id = ai.package_id WHERE ai.issue_id = i.id AND ap.revoked_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM client_decisions d WHERE d.issue_id = i.id)`, ...latestParams),
    pendingApprovals: n(
      `SELECT COUNT(*) AS n FROM approval_packages WHERE ${r.sql} AND revoked_at IS NULL AND submitted_at IS NULL AND expires_at > ?`,
      ...r.params, new Date().toISOString()),
  };
}

export interface ActivityItem { at: string; label: string; href: string; kind: "audit" | "review" | "client" | "export" }

export function recentActivity(user: User, limit = 12): ActivityItem[] {
  const r = projectScope(user, "ar.project_id");
  const audits = all<{ id: string; status: string; created_at: string; finished_at: string | null; name: string }>(
    `SELECT ar.id, ar.status, ar.created_at, ar.finished_at, p.name FROM audit_runs ar JOIN projects p ON p.id = ar.project_id
     WHERE ${r.sql} ORDER BY ar.created_at DESC LIMIT ?`, ...r.params, limit,
  ).map((a) => ({ at: a.finished_at ?? a.created_at, label: `Audit of ${a.name}: ${a.status}`, href: `/audits/${a.id}`, kind: "audit" as const }));

  const i = projectScope(user, "i.project_id");
  const events = all<{ issue_id: string; code: string; action: string; actor_label: string; created_at: string }>(
    `SELECT e.issue_id, i.code, e.action, e.actor_label, e.created_at FROM issue_events e JOIN issues i ON i.id = e.issue_id
     WHERE ${i.sql} ORDER BY e.created_at DESC LIMIT ?`, ...i.params, limit,
  ).map((e) => ({
    at: e.created_at,
    label: `${e.actor_label}: ${e.action.replace(/_/g, " ")} on ${e.code}`,
    href: `/issues/${e.issue_id}`,
    kind: e.actor_label.startsWith("Client:") ? ("client" as const) : ("review" as const),
  }));

  return [...audits, ...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export interface WebsiteSummary {
  id: string; name: string; domain: string;
  lastRunId: string | null; lastAuditAt: string | null; findings: number; high: number; needsReview: number;
  active: { id: string; status: string; pages_done: number; pages_total: number } | null;
}

/** One row per website for the dashboard: latest completed audit counts (excluding false positives) and any audit in progress. */
export function websiteSummaries(user: User): WebsiteSummary[] {
  const s = projectScope(user, "p.id");
  const rows = all<Omit<WebsiteSummary, "active"> & { active_id: string | null }>(
    `SELECT p.id, p.name, p.domain, lr.id AS lastRunId, lr.finished_at AS lastAuditAt,
       (SELECT COUNT(*) FROM issues i WHERE i.run_id = lr.id AND i.verification_status != 'false_positive') AS findings,
       (SELECT COUNT(*) FROM issues i WHERE i.run_id = lr.id AND i.verification_status != 'false_positive' AND i.severity = 'high') AS high,
       (SELECT COUNT(*) FROM issues i WHERE i.run_id = lr.id AND i.kind = 'needs-review' AND i.verification_status = 'unverified') AS needsReview,
       (SELECT id FROM audit_runs a WHERE a.project_id = p.id AND a.status IN ('pending','running') ORDER BY a.created_at DESC LIMIT 1) AS active_id
     FROM projects p
     LEFT JOIN audit_runs lr ON lr.id = (SELECT id FROM audit_runs ar WHERE ar.project_id = p.id AND ar.status = 'completed' ORDER BY ar.created_at DESC LIMIT 1)
     WHERE ${s.sql} ORDER BY COALESCE(lr.finished_at, p.created_at) DESC`, ...s.params);
  return rows.map(({ active_id, ...r }) => ({
    ...r,
    active: active_id ? get<WebsiteSummary["active"]>("SELECT id, status, pages_done, pages_total FROM audit_runs WHERE id = ?", active_id) ?? null : null,
  }));
}
