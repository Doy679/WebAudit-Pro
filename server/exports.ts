import { all, get, run, newId, now, tx } from "./db";
import type { User } from "./auth";
import { assertCan, NotFoundError, projectScope } from "./permissions";
import { getRun } from "./runs";
import type { IssueFilters } from "./issues";

export type ExportFormat = "xlsx" | "pdf" | "html" | "json";
export const FORMATS: ExportFormat[] = ["xlsx", "pdf", "html", "json"];

export interface ExportRow {
  id: string; project_id: string; project_name: string; run_id: string; format: ExportFormat; filters: ExportFilters;
  status: "pending" | "running" | "completed" | "failed"; file_path: string | null; file_name: string | null;
  size_bytes: number | null; issue_count: number | null; error: string | null; created_by: string; created_by_name: string;
  created_at: string; finished_at: string | null;
}

/** What goes into a report. Client-facing PDFs default to reviewed findings only. */
export interface ExportFilters extends Pick<IssueFilters, "type" | "severity" | "kind" | "verification" | "review" | "url" | "ids"> {
  /** Leave out findings marked false positive (default true). */
  excludeFalsePositives?: boolean;
  /** Only findings that were confirmed or approved internally. */
  reviewedOnly?: boolean;
}

export function createExport(user: User, input: { runId: string; format: ExportFormat; filters?: ExportFilters }): string {
  assertCan(user, "export:create");
  const r = getRun(user, input.runId);
  if (r.status !== "completed") throw new Error("Reports can only be generated from a completed audit.");
  if (!FORMATS.includes(input.format)) throw new Error("Unknown report format.");
  const id = newId();
  const ts = now();
  tx(() => {
    run(`INSERT INTO exports (id, project_id, run_id, format, filters_json, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      id, r.project_id, r.id, input.format, JSON.stringify({ excludeFalsePositives: true, ...(input.filters ?? {}) }), user.id, ts);
    run("INSERT INTO jobs (id, type, ref_id, status, created_at) VALUES (?, 'export', ?, 'pending', ?)", newId(), id, ts);
  });
  return id;
}

type Row = Omit<ExportRow, "filters"> & { filters_json: string };
const toExport = ({ filters_json, ...r }: Row): ExportRow => ({ ...r, filters: JSON.parse(filters_json) });
const SELECT = `SELECT e.*, p.name AS project_name, u.name AS created_by_name FROM exports e
                JOIN projects p ON p.id = e.project_id JOIN users u ON u.id = e.created_by`;

export function getExport(user: User, id: string): ExportRow {
  const row = get<Row>(`${SELECT} WHERE e.id = ?`, id);
  if (!row) throw new NotFoundError("Report not found.");
  getRun(user, row.run_id); // access check
  return toExport(row);
}

export function listExports(user: User, runId?: string): ExportRow[] {
  const scope = projectScope(user, "e.project_id");
  return all<Row>(`${SELECT} WHERE ${scope.sql} ${runId ? "AND e.run_id = ?" : ""} ORDER BY e.created_at DESC LIMIT 200`,
    ...scope.params, ...(runId ? [runId] : [])).map(toExport);
}

/** Worker-side access (no user). */
export const exportById = (id: string) => {
  const row = get<Row>(`${SELECT} WHERE e.id = ?`, id);
  return row ? toExport(row) : undefined;
};

export function markExport(id: string, patch: { status: ExportRow["status"]; file_path?: string; file_name?: string; size_bytes?: number; issue_count?: number; error?: string }) {
  run(`UPDATE exports SET status = ?, file_path = COALESCE(?, file_path), file_name = COALESCE(?, file_name), size_bytes = COALESCE(?, size_bytes),
       issue_count = COALESCE(?, issue_count), error = ?, finished_at = CASE WHEN ? IN ('completed','failed') THEN ? ELSE finished_at END WHERE id = ?`,
    patch.status, patch.file_path ?? null, patch.file_name ?? null, patch.size_bytes ?? null, patch.issue_count ?? null,
    patch.error ?? null, patch.status, now(), id);
}

/** What a report with these options will contain (same rules as the report itself), for the Reports preview. */
export function exportPreview(user: User, runId: string, f: ExportFilters): { total: number; high: number; medium: number; low: number } {
  getRun(user, runId); // access check: NotFoundError for outsiders
  const where = ["run_id = ?"];
  const params: unknown[] = [runId];
  const eq = (col: string, v?: string) => { if (v) { where.push(`${col} = ?`); params.push(v); } };
  eq("kind", f.kind); eq("severity", f.severity); eq("type", f.type);
  if (f.excludeFalsePositives !== false) where.push("verification_status != 'false_positive'");
  if (f.reviewedOnly) where.push("(verification_status = 'confirmed' OR review_status = 'approved')");
  if (f.ids?.length) { where.push(`id IN (${f.ids.map(() => "?").join(",")})`); params.push(...f.ids); }
  const r = get<{ total: number; high: number; medium: number; low: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(severity = 'high'), 0) AS high, COALESCE(SUM(severity = 'medium'), 0) AS medium, COALESCE(SUM(severity = 'low'), 0) AS low
     FROM issues WHERE ${where.join(" AND ")}`, ...params)!;
  return { total: r.total, high: r.high, medium: r.medium, low: r.low };
}
