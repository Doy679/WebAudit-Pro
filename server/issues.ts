import { all, get, run, newId, now, tx, safeJson, jsonArray } from "./db";
import type { User } from "./auth";
import { assertCan, assertProjectAccess, ForbiddenError, NotFoundError, projectScope } from "./permissions";

export interface IssueFilters {
  runId?: string;
  projectId?: string;
  url?: string;
  type?: string;
  /** Several categories at once (health cards). */
  types?: string[];
  severity?: string;
  viewport?: number;
  kind?: string;
  verification?: string;
  review?: string;
  implementation?: string;
  assignee?: string; // user id or "none"
  provider?: string;
  quick?: string;
  /** Only findings nobody has reviewed yet (review queue). */
  unreviewed?: boolean;
  minConfidence?: number;
  q?: string;
  sort?: "severity" | "confidence" | "code" | "page" | "updated";
  page?: number;
  pageSize?: number;
  ids?: string[];
}

export interface IssueRow {
  id: string;
  code: string;
  run_id: string;
  project_id: string;
  project_name: string;
  type: string;
  rule: string;
  kind: string;
  severity: string;
  confidence: number;
  title: string;
  url: string;
  pages: string[];
  viewports: number[];
  selector: string | null;
  elementor_id: string | null;
  shared_template: number;
  instance_count: number;
  current_value: string | null;
  proposed_value: string | null;
  recommendation: string;
  verification_status: string;
  review_status: string;
  implementation_status: string;
  priority: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  notes: string;
  fingerprint: string;
  captured_at: string;
  updated_at: string;
  evidence: { screenshots: { viewport: number; path: string }[]; annotated?: string; boxes: { x: number; y: number; w: number; h: number }[]; computedCss?: Record<string, unknown>; capturedAt: string };
  client_decision: string | null;
  /** Set when this finding was merged into another (approved CrUX consolidation). */
  duplicate_of?: string | null;
  /** webaudit (engine), schema (internal validator), psi, crux or gsc. */
  provider: string;
  source_ref: string | null;
  provider_ts: string | null;
  metric_key: string | null;
  /** True when a stored JSON field was missing or malformed and defaults were used. */
  dataWarning?: boolean;
}

const SORTS: Record<NonNullable<IssueFilters["sort"]>, string> = {
  severity: "CASE i.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.confidence DESC, i.code",
  confidence: "i.confidence DESC, i.code",
  code: "i.code",
  page: "i.url, i.code",
  updated: "i.updated_at DESC",
};

/** The latest run of each project that has results; used when no run is selected. */
const LATEST_RUNS = `SELECT (SELECT r.id FROM audit_runs r WHERE r.project_id = p.id AND (r.status = 'completed' OR r.findings > 0)
                     ORDER BY r.created_at DESC LIMIT 1) FROM projects p`;

const EMPTY_EVIDENCE = { screenshots: [], boxes: [], capturedAt: "" };

/** Turns a DB row into an IssueRow; malformed JSON falls back to safe defaults and sets dataWarning. */
const parse = (r: Record<string, unknown>): IssueRow => {
  let warn = false;
  const flag = () => { warn = true; };
  const pages = safeJson<string[]>(r.pages_json, [], flag);
  const viewports = safeJson<number[]>(r.viewports_json, [], flag);
  const ev = safeJson<Partial<IssueRow["evidence"]>>(r.evidence_json, EMPTY_EVIDENCE, flag);
  const { pages_json: _p, viewports_json: _v, evidence_json: _e, occurrences_json: _o, ...rest } = r;
  return {
    ...(rest as unknown as IssueRow),
    pages: Array.isArray(pages) && pages.length ? pages : [r.url as string],
    viewports: Array.isArray(viewports) ? viewports : [],
    evidence: {
      ...EMPTY_EVIDENCE, ...(ev && typeof ev === "object" ? ev : {}),
      screenshots: Array.isArray(ev?.screenshots) ? ev.screenshots : [],
      boxes: Array.isArray(ev?.boxes) ? ev.boxes : [],
    },
    ...(warn ? { dataWarning: true } : {}),
  };
};

/** Columns for list views: everything except the large per-occurrence evidence (up to ~90 KB per finding). */
const LIST_COLUMNS = `i.id, i.run_id, i.project_id, i.code, i.fingerprint, i.type, i.rule, i.kind, i.severity, i.confidence, i.title, i.url,
  i.pages_json, i.viewports_json, i.selector, i.elementor_id, i.shared_template, i.instance_count, i.current_value, i.proposed_value,
  i.recommendation, i.evidence_json, i.captured_at, i.verification_status, i.review_status, i.implementation_status, i.priority,
  i.assignee_id, i.notes, i.updated_at, i.provider, i.source_ref, i.provider_ts, i.metric_key, i.duplicate_of`;

// Quick filters (Issues page chips). Fixed SQL fragments, chosen by a whitelisted key.
const QUICK_SQL = {
  high: "i.severity = 'high'",
  mobile: `EXISTS (SELECT 1 FROM json_each(${jsonArray("i.viewports_json")}) WHERE value < 768)`,
  desktop: `EXISTS (SELECT 1 FROM json_each(${jsonArray("i.viewports_json")}) WHERE value >= 1024)`,
  a11y: "i.type = 'a11y'",
  seo: "i.type IN ('seo', 'structured-data', 'indexing', 'search-console')",
  layout: "i.type IN ('layout', 'spacing')",
  confirmed: "i.kind = 'confirmed'",
  recommendations: "i.kind = 'recommendation'",
  review: "i.kind = 'needs-review'",
  // Released to a client in a package that wasn't revoked, and no client decision yet.
  client: `EXISTS (SELECT 1 FROM approval_items ai JOIN approval_packages ap ON ap.id = ai.package_id WHERE ai.issue_id = i.id AND ap.revoked_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM client_decisions d WHERE d.issue_id = i.id)`,
};

/** WHERE clause shared by the list, its total and the quick-filter counts. */
function issueWhere(user: User, f: IssueFilters): { whereSql: string; params: unknown[] } {
  const scope = projectScope(user, "i.project_id");
  const where = [scope.sql];
  const params: unknown[] = [...scope.params];
  const eq = (col: string, v: unknown) => { if (v !== undefined && v !== "") { where.push(`${col} = ?`); params.push(v); } };
  if (f.runId) eq("i.run_id", f.runId);
  else where.push(`i.run_id IN (${LATEST_RUNS})`);
  eq("i.project_id", f.projectId);
  eq("i.type", f.type);
  if (f.types?.length) { where.push(`i.type IN (${f.types.map(() => "?").join(",")})`); params.push(...f.types); }
  eq("i.severity", f.severity);
  eq("i.kind", f.kind);
  eq("i.verification_status", f.verification);
  eq("i.review_status", f.review);
  eq("i.implementation_status", f.implementation);
  eq("i.provider", f.provider);
  if (f.url) { where.push(`EXISTS (SELECT 1 FROM json_each(${jsonArray("i.pages_json")}) WHERE value = ?)`); params.push(f.url); }
  if (f.viewport) { where.push(`EXISTS (SELECT 1 FROM json_each(${jsonArray("i.viewports_json")}) WHERE value = ?)`); params.push(f.viewport); }
  if (f.assignee === "none") where.push("i.assignee_id IS NULL");
  else eq("i.assignee_id", f.assignee);
  // Review queue: findings nobody has reviewed yet (neither verified/dismissed nor approved/rejected).
  if (f.unreviewed) where.push("i.verification_status = 'unverified' AND i.review_status = 'pending'");
  const quick = QUICK_SQL[f.quick as keyof typeof QUICK_SQL];
  if (quick) where.push(quick);
  if (f.minConfidence) { where.push("i.confidence >= ?"); params.push(f.minConfidence); }
  if (f.ids?.length) { where.push(`i.id IN (${f.ids.map(() => "?").join(",")})`); params.push(...f.ids); }
  if (f.q?.trim()) {
    where.push("(i.code LIKE ? OR i.title LIKE ? OR i.rule LIKE ? OR i.selector LIKE ? OR i.url LIKE ? OR i.current_value LIKE ? OR i.notes LIKE ? OR i.metric_key LIKE ?)");
    const like = `%${f.q.trim()}%`;
    params.push(like, like, like, like, like, like, like, like);
  }
  return { whereSql: where.join(" AND "), params };
}

export function listIssues(user: User, f: IssueFilters): { rows: IssueRow[]; total: number; page: number; pageSize: number } {
  const { whereSql, params } = issueWhere(user, f);
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM issues i WHERE ${whereSql}`, ...params)!.n;
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 1000);
  const page = Math.max(f.page ?? 1, 1);
  const rows = all<Record<string, unknown>>(
    `SELECT ${LIST_COLUMNS}, p.name AS project_name, u.name AS assignee_name,
       (SELECT d.decision FROM client_decisions d WHERE d.issue_id = i.id ORDER BY d.created_at DESC LIMIT 1) AS client_decision
     FROM issues i JOIN projects p ON p.id = i.project_id LEFT JOIN users u ON u.id = i.assignee_id
     WHERE ${whereSql} ORDER BY ${SORTS[f.sort as keyof typeof SORTS] ?? SORTS.severity} LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize,
  ).map(parse);
  return { rows, total, page, pageSize };
}

export interface IssueEvent { id: string; action: string; actor_label: string; from_value: string | null; to_value: string | null; note: string | null; created_at: string }

export interface IssueDetail extends IssueRow {
  occurrences: { url: string; viewport: number; selector?: string; screenshot: string; boxes: unknown[] }[];
  events: IssueEvent[];
  run_status: string;
  run_created_at: string;
  run_dir: string | null;
  decisions: { decision: string; comment: string; client_name: string; client_email: string; created_at: string; package_title: string }[];
}

export function getIssue(user: User, id: string): IssueDetail {
  const r = get<Record<string, unknown>>(
    `SELECT i.*, p.name AS project_name, u.name AS assignee_name, ar.status AS run_status, ar.created_at AS run_created_at, ar.run_dir,
       (SELECT d.decision FROM client_decisions d WHERE d.issue_id = i.id ORDER BY d.created_at DESC LIMIT 1) AS client_decision
     FROM issues i JOIN projects p ON p.id = i.project_id JOIN audit_runs ar ON ar.id = i.run_id LEFT JOIN users u ON u.id = i.assignee_id
     WHERE i.id = ?`, id);
  if (!r) throw new NotFoundError("Finding not found.");
  assertProjectAccess(user, r.project_id as string);
  const base = parse(r);
  let occWarn = false;
  const occurrences = safeJson<IssueDetail["occurrences"]>(r.occurrences_json, [], () => { occWarn = true; });
  return {
    ...base,
    ...(occWarn ? { dataWarning: true } : {}),
    occurrences: Array.isArray(occurrences) ? occurrences : [],
    run_status: r.run_status as string,
    run_created_at: r.run_created_at as string,
    run_dir: r.run_dir as string | null,
    events: all<IssueEvent>("SELECT id, action, actor_label, from_value, to_value, note, created_at FROM issue_events WHERE issue_id = ? ORDER BY created_at, rowid", id),
    decisions: all(`SELECT d.decision, d.comment, d.client_name, d.client_email, d.created_at, ap.title AS package_title
                    FROM client_decisions d JOIN approval_packages ap ON ap.id = d.package_id WHERE d.issue_id = ? ORDER BY d.created_at DESC`, id),
  };
}

export type ReviewAction =
  | { action: "confirm" | "false_positive" | "unverify" | "approve" | "request_revision" | "reject" | "reopen"; note?: string }
  | { action: "assign"; assigneeId: string | null; note?: string }
  | { action: "priority"; priority: "high" | "medium" | "low" | null; note?: string }
  | { action: "note"; note: string }
  | { action: "implementation"; status: "todo" | "in_progress" | "done" | "wont_fix"; note?: string };

const VERIFY: Record<string, string> = { confirm: "confirmed", false_positive: "false_positive", unverify: "unverified" };
// "reopen" undoes an approve / revision / reject decision from the review queue (UX-03).
const REVIEW: Record<string, string> = { approve: "approved", request_revision: "revision_requested", reject: "rejected", reopen: "pending" };

export function logEvent(issueId: string, user: User, action: string, from: string | null, to: string | null, note?: string) {
  run(`INSERT INTO issue_events (id, issue_id, user_id, actor_label, action, from_value, to_value, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(), issueId, user.id, user.name, action, from, to, note?.trim() || null, now());
}

export function reviewIssue(user: User, id: string, a: ReviewAction) {
  const row = get<{ project_id: string; verification_status: string; review_status: string; implementation_status: string; assignee_id: string | null; priority: string | null; notes: string }>(
    "SELECT project_id, verification_status, review_status, implementation_status, assignee_id, priority, notes FROM issues WHERE id = ?", id);
  if (!row) throw new NotFoundError("Finding not found.");
  assertProjectAccess(user, row.project_id);
  const ts = now();

  if (a.action in VERIFY || a.action in REVIEW || a.action === "assign" || a.action === "priority") assertCan(user, "issue:review");
  if (a.action === "implementation") {
    assertCan(user, "issue:implement");
    if (user.role === "developer" && row.assignee_id && row.assignee_id !== user.id) throw new ForbiddenError("This finding is assigned to someone else.");
  }

  if (a.action in VERIFY) {
    run("UPDATE issues SET verification_status = ?, updated_at = ? WHERE id = ?", VERIFY[a.action], ts, id);
    logEvent(id, user, a.action, row.verification_status, VERIFY[a.action], a.note);
  } else if (a.action in REVIEW) {
    run("UPDATE issues SET review_status = ?, updated_at = ? WHERE id = ?", REVIEW[a.action], ts, id);
    logEvent(id, user, a.action, row.review_status, REVIEW[a.action], a.note);
  } else if (a.action === "assign") {
    if (a.assigneeId && !get("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?", row.project_id, a.assigneeId)) {
      throw new Error("Assign the finding to a member of this project.");
    }
    run("UPDATE issues SET assignee_id = ?, updated_at = ? WHERE id = ?", a.assigneeId, ts, id);
    const name = a.assigneeId ? get<{ name: string }>("SELECT name FROM users WHERE id = ?", a.assigneeId)?.name ?? null : null;
    logEvent(id, user, "assign", row.assignee_id, name, a.note);
  } else if (a.action === "priority") {
    run("UPDATE issues SET priority = ?, updated_at = ? WHERE id = ?", a.priority, ts, id);
    logEvent(id, user, "priority", row.priority, a.priority, a.note);
  } else if (a.action === "implementation") {
    run("UPDATE issues SET implementation_status = ?, updated_at = ? WHERE id = ?", a.status, ts, id);
    logEvent(id, user, "implementation", row.implementation_status, a.status, a.note);
  }
  if (a.action === "note" || a.note?.trim()) {
    const text = (a.note ?? "").trim();
    if (!text) throw new Error("Write a note first.");
    if (text.length > 5000) throw new Error("Notes are limited to 5,000 characters.");
    const stamped = `[${ts.slice(0, 16).replace("T", " ")} ${user.name}] ${text}`;
    run("UPDATE issues SET notes = ?, updated_at = ? WHERE id = ?", row.notes ? `${row.notes}\n${stamped}` : stamped, ts, id);
    if (a.action === "note") logEvent(id, user, "note", null, null, text);
  }
}

export function bulkReview(user: User, ids: string[], a: ReviewAction): number {
  if (!ids.length) throw new Error("Select at least one finding.");
  if (ids.length > 1000) throw new Error("Select at most 1,000 findings at a time.");
  tx(() => ids.forEach((id) => reviewIssue(user, id, a)));
  return ids.length;
}

/** Distinct values for filter dropdowns, within the user's scope. */
function runProject(user: User, runId: string): string {
  const r = get<{ project_id: string }>("SELECT project_id FROM audit_runs WHERE id = ?", runId);
  if (!r) throw new NotFoundError("Audit run not found.");
  assertProjectAccess(user, r.project_id);
  return r.project_id;
}

/** The fields the quality score needs, for every finding in the run (no row cap). */
export function runScoreInputs(user: User, runId: string) {
  runProject(user, runId);
  return all<{ kind: string; severity: string; type: string; verification_status: string }>(
    "SELECT kind, severity, type, verification_status FROM issues WHERE run_id = ?", runId);
}

/** Every internally reviewed finding (confirmed or approved, never false positives) that may be released to a client. */
export function releasableIssues(user: User, runId: string) {
  runProject(user, runId);
  return all<{ id: string; code: string; title: string; severity: string; verification_status: string; review_status: string }>(
    `SELECT id, code, title, severity, verification_status, review_status FROM issues
     WHERE run_id = ? AND verification_status != 'false_positive' AND (verification_status = 'confirmed' OR review_status = 'approved')
     ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, code`, runId);
}

/** Distinct values for the filter dropdowns, limited to the selected run or website so no other project's pages appear. */
export function filterOptions(user: User, runId?: string, projectId?: string) {
  const scope = projectScope(user, "i.project_id");
  const runSql = (runId ? "i.run_id = ?" : `i.run_id IN (${LATEST_RUNS})`) + (projectId ? " AND i.project_id = ?" : "");
  const params = [...scope.params, ...(runId ? [runId] : []), ...(projectId ? [projectId] : [])];
  const distinct = (col: string) => all<{ v: string }>(`SELECT DISTINCT ${col} AS v FROM issues i WHERE ${scope.sql} AND ${runSql} ORDER BY v`, ...params).map((r) => r.v);
  return {
    types: distinct("i.type"),
    providers: distinct("i.provider"),
    pages: all<{ v: string }>(`SELECT DISTINCT j.value AS v FROM issues i, json_each(${jsonArray("i.pages_json")}) j WHERE ${scope.sql} AND ${runSql} ORDER BY v`, ...params).map((r) => r.v),
    viewports: all<{ v: number }>(`SELECT DISTINCT j.value AS v FROM issues i, json_each(${jsonArray("i.viewports_json")}) j WHERE ${scope.sql} AND ${runSql} AND typeof(j.value) = 'integer' ORDER BY v`, ...params).map((r) => r.v),
  };
}

/** BUG-17: a bulk change needs an explicit action, at least one row, and confirmation above 10 rows. */
export function checkBulkRequest(action: string, count: number, confirmedLarge: boolean) {
  if (!action) throw new Error("Choose an action first.");
  if (!count) throw new Error("Select at least one finding.");
  if (count > 10 && !confirmedLarge) throw new Error(`You selected ${count} findings. Tick "Yes, apply to all selected" to confirm, then press Apply again.`);
}

/**
 * BUG-18: review actions that make sense for a classification. Measured or uncertain findings are confirmed or
 * dismissed; recommendations are approved, sent back or rejected. A note can always be added.
 */
export function reviewActionsFor(kind: string): { action: "confirm" | "false_positive" | "approve" | "request_revision" | "reject" | "note"; label: string; variant: "secondary" | "danger" }[] {
  const note = { action: "note" as const, label: "Add note only", variant: "secondary" as const };
  return kind === "recommendation"
    ? [
        { action: "approve", label: "Approve recommendation", variant: "secondary" },
        { action: "request_revision", label: "Request revision", variant: "secondary" },
        { action: "reject", label: "Reject recommendation", variant: "danger" },
        note,
      ]
    : [
        { action: "confirm", label: "Confirm finding", variant: "secondary" },
        { action: "false_positive", label: "Mark false positive", variant: "secondary" },
        note,
      ];
}

/** UX-04: the number of findings each quick filter would show, using exactly the list's own query. */
export function quickFilterCounts(user: User, f: IssueFilters): Record<string, number> {
  const { whereSql, params } = issueWhere(user, { ...f, quick: undefined });
  const keys = Object.keys(QUICK_SQL) as (keyof typeof QUICK_SQL)[];
  const row = get<Record<string, number>>(
    `SELECT COUNT(*) AS "all", ${keys.map((k) => `COALESCE(SUM(CASE WHEN ${QUICK_SQL[k]} THEN 1 ELSE 0 END), 0) AS "${k}"`).join(", ")} FROM issues i WHERE ${whereSql}`, ...params)!;
  return { ...row };
}

/**
 * BUG-11: display IDs restart per website (CNT-0001 exists for every site), so anything quoted on its own gets a
 * website prefix: "Capital Home Mortgage" → CHM, "RedRiverModularHomes" → RRMH. Stored IDs and links don't change.
 */
export function projectCode(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const code = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 4);
  return (code || "WEB").toUpperCase().slice(0, 6);
}
export const issueReference = (projectName: string, code: string) => `${projectCode(projectName)}-${code}`;

export interface ReviewQueueItem {
  item: IssueDetail;
  /** 0-based position among the findings still to review (with the same filters). */
  position: number;
  remaining: number;
  reviewed: number;
  total: number;
  /** Other unreviewed findings in the same audit with the same rule and the same measured value (safe to review together). */
  similar: string[];
}

/** UX-03: one unreviewed finding at a time, highest priority first, plus progress for the same filters. */
export function reviewQueue(user: User, f: IssueFilters, position: number): ReviewQueueItem | null {
  const scope = { ...f, page: 1, pageSize: 1 };
  const remaining = listIssues(user, { ...scope, unreviewed: true }).total;
  if (!remaining) return null;
  const pos = Math.min(Math.max(Math.floor(position) || 0, 0), remaining - 1);
  const row = listIssues(user, { ...scope, unreviewed: true, page: pos + 1, sort: f.sort ?? "severity" }).rows[0];
  const item = getIssue(user, row.id);
  const total = listIssues(user, { ...scope, unreviewed: false }).total;
  const similar = all<{ id: string }>(
    `SELECT id FROM issues WHERE run_id = ? AND rule = ? AND current_value IS ? AND id != ? AND verification_status = 'unverified' AND review_status = 'pending'`,
    item.run_id, item.rule, item.current_value, item.id).map((r) => r.id);
  return { item, position: pos, remaining, reviewed: total - remaining, total, similar };
}

/**
 * UX-02: plain words for a finding's four separate statuses, so "Confirmed" never appears next to "Unverified".
 * Display only: stored values, exports and client links keep their existing terms.
 */
export function statusWords(i: Pick<IssueRow, "kind" | "verification_status" | "review_status" | "implementation_status" | "client_decision"> & { duplicate_of?: string | null }) {
  const detected = i.kind === "confirmed" ? "Measured problem" : i.kind === "recommendation" ? "Recommendation" : "Possible problem";
  const team = i.duplicate_of ? "Merged into the whole-site finding (same value)"
    : i.verification_status === "false_positive" ? "False positive (not a real problem)"
    : i.verification_status === "confirmed" ? "Accepted by your team"
    : i.review_status === "approved" ? "Approved by your team"
    : i.review_status === "revision_requested" ? "Revision requested"
    : i.review_status === "rejected" ? "Rejected by your team"
    : "Not reviewed yet";
  const client = i.client_decision === "approved" ? "Client approved" : i.client_decision === "rejected" ? "Client rejected"
    : i.client_decision === "revision_requested" ? "Client asked for changes" : "No client decision";
  const fix = { todo: "Not fixed yet", in_progress: "Fix in progress", done: "Fixed", wont_fix: "Won't fix" }[i.implementation_status] ?? i.implementation_status;
  return { detected, team, client, fix };
}
