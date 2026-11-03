import { all, get } from "../db";
import type { ExportFilters, ExportRow } from "../exports";
import { qualityScore } from "../score";
import { getSetting } from "../settings";

export interface ReportIssue {
  id: string; code: string; type: string; rule: string; kind: string; severity: string; confidence: number; title: string;
  url: string; pages: string[]; viewports: number[]; selector: string | null; elementor_id: string | null; shared_template: number;
  instance_count: number; current_value: string | null; proposed_value: string | null; recommendation: string;
  evidence: { screenshots: { viewport: number; path: string }[]; annotated?: string; computedCss?: Record<string, unknown>; capturedAt: string };
  verification_status: string; review_status: string; implementation_status: string; priority: string | null;
  assignee_name: string | null; notes: string; captured_at: string;
  client_decision: string | null; client_comment: string | null; client_name: string | null;
}

export interface ReportData {
  brand: string;
  appUrl: string;
  generatedAt: string;
  generatedBy: string;
  filters: ExportFilters;
  project: { id: string; name: string; base_url: string; domain: string; authorization_note: string; authorized_at: string; standards: Record<string, string> };
  run: { id: string; start_url: string; created_at: string; started_at: string | null; finished_at: string | null; settings: Record<string, unknown>; run_dir: string | null; summary: Record<string, unknown> | null };
  pages: { url: string; ok: number; status: number; error: string | null; findings: number }[];
  issues: ReportIssue[];
  allIssueCount: number;
  score: ReturnType<typeof qualityScore>;
}

const SEV = { high: 0, medium: 1, low: 2 } as Record<string, number>;

export function applyFilters(issues: ReportIssue[], f: ExportFilters): ReportIssue[] {
  return issues.filter((i) =>
    (!f.ids?.length || f.ids.includes(i.id)) &&
    (!f.kind || i.kind === f.kind) && (!f.severity || i.severity === f.severity) && (!f.type || i.type === f.type) &&
    (!f.verification || i.verification_status === f.verification) && (!f.review || i.review_status === f.review) &&
    (!f.url || i.pages.includes(f.url)) &&
    (f.excludeFalsePositives === false || i.verification_status !== "false_positive") &&
    (!f.reviewedOnly || i.verification_status === "confirmed" || i.review_status === "approved"));
}

/** Everything a report needs, read from saved audit + review data only. */
export function loadReportData(exp: ExportRow): ReportData {
  const project = get<{ id: string; name: string; base_url: string; domain: string; authorization_note: string; authorized_at: string; settings_json: string }>(
    "SELECT id, name, base_url, domain, authorization_note, authorized_at, settings_json FROM projects WHERE id = ?", exp.project_id)!;
  const run = get<{ id: string; start_url: string; created_at: string; started_at: string | null; finished_at: string | null; settings_json: string; run_dir: string | null; summary_json: string | null }>(
    "SELECT id, start_url, created_at, started_at, finished_at, settings_json, run_dir, summary_json FROM audit_runs WHERE id = ?", exp.run_id)!;
  const raw = all<Record<string, unknown>>(
    `SELECT i.*, u.name AS assignee_name,
       (SELECT d.decision FROM client_decisions d WHERE d.issue_id = i.id ORDER BY d.created_at DESC LIMIT 1) AS client_decision,
       (SELECT d.comment FROM client_decisions d WHERE d.issue_id = i.id ORDER BY d.created_at DESC LIMIT 1) AS client_comment,
       (SELECT d.client_name FROM client_decisions d WHERE d.issue_id = i.id ORDER BY d.created_at DESC LIMIT 1) AS client_name
     FROM issues i LEFT JOIN users u ON u.id = i.assignee_id WHERE i.run_id = ?`, exp.run_id);
  const everything: ReportIssue[] = raw.map((r) => ({
    ...(r as unknown as ReportIssue),
    pages: JSON.parse(r.pages_json as string),
    viewports: JSON.parse(r.viewports_json as string),
    evidence: JSON.parse(r.evidence_json as string),
  })).sort((a, b) => (SEV[a.severity] - SEV[b.severity]) || b.confidence - a.confidence || a.code.localeCompare(b.code));

  const pagesRaw = all<{ url: string; ok: number; status: number; error: string | null }>("SELECT url, ok, status, error FROM run_pages WHERE run_id = ? ORDER BY url", exp.run_id);
  const live = everything.filter((i) => i.verification_status !== "false_positive");
  const pages = pagesRaw.map((p) => ({ ...p, findings: live.filter((i) => i.pages.includes(p.url)).length }));
  const settings = JSON.parse(project.settings_json) as { tokens?: { standards?: Record<string, string> } };

  return {
    brand: getSetting("brand.name") || "WebAudit Pro",
    appUrl: (process.env.WEBAUDIT_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    generatedAt: new Date().toISOString(),
    generatedBy: exp.created_by_name,
    filters: exp.filters,
    project: { ...project, standards: settings.tokens?.standards ?? {} },
    run: { ...run, settings: JSON.parse(run.settings_json), summary: run.summary_json ? JSON.parse(run.summary_json) : null },
    pages,
    issues: applyFilters(everything, exp.filters),
    allIssueCount: everything.length,
    score: qualityScore(live, pagesRaw.filter((p) => p.ok).length, pagesRaw.length),
  };
}

export const LABEL: Record<string, string> = {
  confirmed: "Confirmed", recommendation: "Recommendation", "needs-review": "Needs review",
  unverified: "Unverified", false_positive: "False positive", pending: "Pending review", approved: "Approved",
  revision_requested: "Revision requested", rejected: "Rejected", todo: "To do", in_progress: "In progress", done: "Done", wont_fix: "Won't fix",
  high: "High", medium: "Medium", low: "Low",
};
export const label = (v: string | null | undefined) => (v ? LABEL[v] ?? v : "");

/** One consistent status phrase used by every format, e.g. "Verified · Approved". */
export const statusText = (i: ReportIssue) =>
  [i.verification_status === "confirmed" ? "Verified" : label(i.verification_status), label(i.review_status)].join(" · ");
