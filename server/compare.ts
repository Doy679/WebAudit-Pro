import { all } from "./db";
import type { User } from "./auth";
import { getRun } from "./runs";

export type CompareStatus = "new" | "still_present" | "changed" | "resolved" | "reopened" | "unable_to_verify";

export interface CompareIssue {
  id: string;
  code: string;
  fingerprint: string;
  title: string;
  rule: string;
  severity: string;
  kind: string;
  pages: string[];
  current: string | null;
}

export interface CompareRow {
  fingerprint: string;
  status: CompareStatus;
  title: string;
  rule: string;
  severity: string;
  pages: string[];
  baseIssue?: CompareIssue;
  latestIssue?: CompareIssue;
  before: string | null;
  after: string | null;
}

/**
 * Classifies findings between a base run and a newer run by fingerprint.
 * `latestOkPages`: pages scanned successfully in the newer run. A missing finding only counts as
 * resolved if all its pages were scanned OK; otherwise it is "unable to verify".
 * `earlierFingerprints`: fingerprints seen in runs older than the base, used to detect reopened findings.
 */
export function compareRuns(base: CompareIssue[], latest: CompareIssue[], latestOkPages: Set<string>, earlierFingerprints: Set<string>): CompareRow[] {
  const baseBy = new Map(base.map((i) => [i.fingerprint, i]));
  const latestBy = new Map(latest.map((i) => [i.fingerprint, i]));
  const rows: CompareRow[] = [];

  for (const b of base) {
    const l = latestBy.get(b.fingerprint);
    if (l) {
      const changed = (b.current ?? "") !== (l.current ?? "");
      rows.push({ fingerprint: b.fingerprint, status: changed ? "changed" : "still_present", title: l.title, rule: l.rule, severity: l.severity, pages: l.pages, baseIssue: b, latestIssue: l, before: b.current, after: l.current });
    } else {
      const verifiable = b.pages.every((p) => latestOkPages.has(p));
      rows.push({ fingerprint: b.fingerprint, status: verifiable ? "resolved" : "unable_to_verify", title: b.title, rule: b.rule, severity: b.severity, pages: b.pages, baseIssue: b, before: b.current, after: null });
    }
  }
  for (const l of latest) {
    if (baseBy.has(l.fingerprint)) continue;
    rows.push({
      fingerprint: l.fingerprint, status: earlierFingerprints.has(l.fingerprint) ? "reopened" : "new",
      title: l.title, rule: l.rule, severity: l.severity, pages: l.pages, latestIssue: l, before: null, after: l.current,
    });
  }
  const order: CompareStatus[] = ["new", "reopened", "changed", "still_present", "unable_to_verify", "resolved"];
  return rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.title.localeCompare(b.title));
}

const loadIssues = (runId: string) =>
  all<{ id: string; code: string; fingerprint: string; title: string; rule: string; severity: string; kind: string; pages_json: string; current_value: string | null }>(
    "SELECT id, code, fingerprint, title, rule, severity, kind, pages_json, current_value FROM issues WHERE run_id = ? AND verification_status != 'false_positive'", runId,
  ).map((r) => ({ id: r.id, code: r.code, fingerprint: r.fingerprint, title: r.title, rule: r.rule, severity: r.severity, kind: r.kind, pages: JSON.parse(r.pages_json), current: r.current_value }));

/** Compares two runs of the same project (access-checked). */
export function compareProjectRuns(user: User, baseRunId: string, latestRunId: string) {
  const base = getRun(user, baseRunId);
  const latest = getRun(user, latestRunId);
  if (base.project_id !== latest.project_id) throw new Error("Choose two audits of the same project.");
  if (base.created_at > latest.created_at) throw new Error("The base audit must be older than the comparison audit.");
  const okPages = new Set(all<{ url: string }>("SELECT url FROM run_pages WHERE run_id = ? AND ok = 1", latestRunId).map((r) => r.url));
  const earlier = new Set(all<{ fingerprint: string }>(
    `SELECT DISTINCT i.fingerprint FROM issues i JOIN audit_runs r ON r.id = i.run_id
     WHERE r.project_id = ? AND r.created_at < ? AND i.verification_status != 'false_positive'`, base.project_id, base.created_at,
  ).map((r) => r.fingerprint));
  const rows = compareRuns(loadIssues(baseRunId), loadIssues(latestRunId), okPages, earlier);
  const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  return { base, latest, rows, counts };
}
