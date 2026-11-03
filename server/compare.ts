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
  /** webaudit | schema | psi | crux | gsc */
  provider?: string;
  /** Strategy or other provider key needed to decide coverage. */
  providerKey?: string | null;
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
export function compareRuns(
  base: CompareIssue[],
  latest: CompareIssue[],
  latestOkPages: Set<string>,
  earlierFingerprints: Set<string>,
  /** Whether the source that produced this finding ran successfully for it in the newer audit (default: its pages were scanned OK). */
  covered: (i: CompareIssue) => boolean = (i) => i.pages.every((p) => latestOkPages.has(p)),
): CompareRow[] {
  const baseBy = new Map(base.map((i) => [i.fingerprint, i]));
  const latestBy = new Map(latest.map((i) => [i.fingerprint, i]));
  const rows: CompareRow[] = [];

  for (const b of base) {
    const l = latestBy.get(b.fingerprint);
    if (l) {
      const changed = (b.current ?? "") !== (l.current ?? "");
      rows.push({ fingerprint: b.fingerprint, status: changed ? "changed" : "still_present", title: l.title, rule: l.rule, severity: l.severity, pages: l.pages, baseIssue: b, latestIssue: l, before: b.current, after: l.current });
    } else {
      const verifiable = covered(b);
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
  all<{ id: string; code: string; fingerprint: string; title: string; rule: string; severity: string; kind: string; pages_json: string; current_value: string | null; provider: string; evidence_json: string }>(
    "SELECT id, code, fingerprint, title, rule, severity, kind, pages_json, current_value, provider, evidence_json FROM issues WHERE run_id = ? AND verification_status != 'false_positive'", runId,
  ).map((r) => ({
    id: r.id, code: r.code, fingerprint: r.fingerprint, title: r.title, rule: r.rule, severity: r.severity, kind: r.kind, pages: JSON.parse(r.pages_json),
    current: r.current_value, provider: r.provider, providerKey: (JSON.parse(r.evidence_json).computedCss?.strategy as string | undefined) ?? null,
  }));

/** For each provider, which findings the newer audit actually re-measured. */
function coverage(latestRunId: string, okPages: Set<string>) {
  const settings = JSON.parse(all<{ s: string }>("SELECT settings_json AS s FROM audit_runs WHERE id = ?", latestRunId)[0].s) as { categories?: string[] };
  const schemaRan = !settings.categories?.length || settings.categories.includes("structured-data");
  const psiOk = new Set(all<{ k: string }>("SELECT url || '|' || strategy AS k FROM psi_results WHERE run_id = ? AND status = 'ok'", latestRunId).map((r) => r.k));
  const inspected = new Set(all<{ key: string }>("SELECT key FROM gsc_data WHERE run_id = ? AND kind = 'inspection' AND status = 'ok'", latestRunId).map((r) => r.key));
  const sitemapsOk = all("SELECT 1 FROM gsc_data WHERE run_id = ? AND kind = 'sitemaps' AND status = 'ok'", latestRunId).length > 0;
  return (i: CompareIssue) => {
    const pagesOk = i.pages.every((p) => okPages.has(p));
    switch (i.provider) {
      case "psi": case "crux": return i.pages.every((p) => psiOk.has(`${p}|${i.providerKey}`));
      case "gsc": return i.rule === "gsc:sitemap-errors" ? sitemapsOk : i.pages.every((p) => inspected.has(p));
      case "schema": return schemaRan && pagesOk;
      default: return pagesOk;
    }
  };
}

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
  const rows = compareRuns(loadIssues(baseRunId), loadIssues(latestRunId), okPages, earlier, coverage(latestRunId, okPages));
  const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  return { base, latest, rows, counts };
}
