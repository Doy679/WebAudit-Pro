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
