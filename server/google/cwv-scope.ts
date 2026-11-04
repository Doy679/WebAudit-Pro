// BUG-05: whether a real-user (CrUX) finding describes one page or the whole website, decided from the stored
// PageSpeed result, plus a read-only dry run of consolidating whole-site findings (changing them needs approval).
import { all, get, run, safeJson, tx } from "../db";
import type { User } from "../auth";
import { assertCan, assertProjectAccess } from "../permissions";
import { logEvent } from "../issues";
import type { FieldData } from "./types";

export interface CwvScope { scope: "url" | "origin"; label: string; samePages: number }

type Psi = { field?: FieldData | null; originField?: FieldData | null };

const p75s = (f?: FieldData | null) => JSON.stringify(Object.entries(f?.metrics ?? {}).map(([k, m]) => [k, m?.p75]));

/** Origin data: labelled origin by PageSpeed (origin_fallback), or page data identical to the site data. */
export function isOriginField(r: Psi): boolean {
  if (!r.field) return false;
  if (r.field.scope === "origin") return true;
  return !!r.originField && p75s(r.field) === p75s(r.originField);
}

/** Scope of one CWV finding, or null for other findings / when the PageSpeed result is no longer stored. */
export function cwvDataScope(issueId: string): CwvScope | null {
  const i = get<{ run_id: string; type: string; rule: string; url: string; evidence_json: string; current_value: string | null }>(
    "SELECT run_id, type, rule, url, evidence_json, current_value FROM issues WHERE id = ?", issueId);
  if (!i || i.type !== "cwv") return null;
  const strategy = safeJson<{ computedCss?: { strategy?: string } }>(i.evidence_json, {}).computedCss?.strategy;
  const row = get<{ result_json: string }>(
    "SELECT result_json FROM psi_results WHERE run_id = ? AND url = ? AND strategy = ? AND status = 'ok' ORDER BY fetched_at DESC, rowid DESC LIMIT 1",
    i.run_id, i.url, strategy ?? "mobile");
  const origin = i.rule.startsWith("crux:origin:") || (!!row && isOriginField(safeJson<Psi>(row.result_json, {})));
  if (!origin) return row || i.rule.startsWith("crux:") ? { scope: "url", label: "This page (URL-level measurement)", samePages: 1 } : null;
  const samePages = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM issues WHERE run_id = ? AND type = 'cwv' AND rule = ? AND current_value IS ? AND evidence_json LIKE ?",
    i.run_id, i.rule, i.current_value, `%"strategy":"${strategy ?? "mobile"}"%`)?.n ?? 1;
  return { scope: "origin", label: "Whole website (origin-level measurement)", samePages };
}

export interface OriginImpact {
  runId: string;
  duplicateFindings: number;
  groups: { metric: string; strategy: string; findings: number; pages: number; severity: string }[];
  highNow: number;
  highAfter: number;
}

/** Read-only: how many CWV findings in an audit are copies of whole-site data, and the High count after consolidation. */
export function originCwvImpact(runId: string): OriginImpact {
  const rows = all<{ id: string; rule: string; severity: string; url: string; evidence_json: string }>(
    "SELECT id, rule, severity, url, evidence_json FROM issues WHERE run_id = ? AND type = 'cwv' AND verification_status != 'false_positive'", runId);
  const groups = new Map<string, { metric: string; strategy: string; findings: number; pages: Set<string>; severity: string }>();
  for (const r of rows) {
    const s = cwvDataScope(r.id);
    if (s?.scope !== "origin") continue;
    const strategy = safeJson<{ computedCss?: { strategy?: string } }>(r.evidence_json, {}).computedCss?.strategy ?? "mobile";
    const metric = r.rule.replace(/^crux:(origin:)?/, "");
    const g = groups.get(`${metric}|${strategy}`) ?? { metric, strategy, findings: 0, pages: new Set<string>(), severity: r.severity };
    g.findings++;
    g.pages.add(r.url);
    groups.set(`${metric}|${strategy}`, g);
  }
  const list = [...groups.values()].map((g) => ({ metric: g.metric, strategy: g.strategy, findings: g.findings, pages: g.pages.size, severity: g.severity }));
  const removed = list.reduce((n, g) => n + g.findings - 1, 0);
  const highRemoved = list.filter((g) => g.severity === "high").reduce((n, g) => n + g.findings - 1, 0);
  const highNow = get<{ n: number }>("SELECT COUNT(*) AS n FROM issues WHERE run_id = ? AND severity = 'high' AND verification_status != 'false_positive'", runId)?.n ?? 0;
  return { runId, duplicateFindings: removed, groups: list, highNow, highAfter: highNow - highRemoved };
}

/**
 * Approved consolidation (2026-11-04): in each metric + device group of whole-site findings, keep one finding (the
 * start page's if present, otherwise the lowest code) and mark the per-page copies as merged duplicates. Copies are
 * excluded from counts and reports like false positives, keep their record and history, and can be restored with
 * revertOriginCwv. Only untouched findings are merged; reviewed or client-decided ones are skipped.
 */
export function consolidateOriginCwv(user: User, runId: string): { merged: number; kept: number; skipped: number } {
  assertCan(user, "issue:review");
  const r = get<{ project_id: string; start_url: string }>("SELECT project_id, start_url FROM audit_runs WHERE id = ?", runId);
  if (!r) throw new Error("Audit not found.");
  assertProjectAccess(user, r.project_id);
  const rows = all<{ id: string; code: string; rule: string; url: string; evidence_json: string; verification_status: string; review_status: string; notes: string }>(
    `SELECT id, code, rule, url, evidence_json, verification_status, review_status, notes FROM issues
     WHERE run_id = ? AND type = 'cwv' AND duplicate_of IS NULL AND verification_status != 'false_positive' ORDER BY code`, runId);
  const groups = new Map<string, typeof rows>();
  for (const i of rows) {
    if (cwvDataScope(i.id)?.scope !== "origin") continue;
    const strategy = safeJson<{ computedCss?: { strategy?: string } }>(i.evidence_json, {}).computedCss?.strategy ?? "mobile";
    const key = `${i.rule.replace(/^crux:(origin:)?/, "")}|${strategy}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  let merged = 0, kept = 0, skipped = 0;
  tx(() => {
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const keep = list.find((i) => i.url === r.start_url) ?? list[0];
      const copies = list.filter((i) => i !== keep);
      const untouched = copies.filter((i) => i.verification_status === "unverified" && i.review_status === "pending" &&
        !get("SELECT 1 FROM client_decisions WHERE issue_id = ?", i.id) && !get("SELECT 1 FROM approval_items WHERE issue_id = ?", i.id));
      skipped += copies.length - untouched.length;
      if (!untouched.length) continue;
      kept++;
      const ts = new Date().toISOString();
      for (const c of untouched) {
        const note = `Merged into ${keep.code}: the same whole-site (origin-level) value, reported once for the site.`;
        run("UPDATE issues SET verification_status = 'false_positive', duplicate_of = ?, notes = TRIM(notes || char(10) || ?), updated_at = ? WHERE id = ?", keep.id, note, ts, c.id);
        logEvent(c.id, user, "merged_duplicate", c.verification_status, "false_positive", note);
        merged++;
      }
      const keepNote = `Whole-site value: it was also reported for ${untouched.length} other pages (${untouched.map((c) => c.code).join(", ")}), now merged into this finding.`;
      run("UPDATE issues SET notes = TRIM(notes || char(10) || ?), updated_at = ? WHERE id = ?", keepNote, ts, keep.id);
      logEvent(keep.id, user, "note", null, null, keepNote);
    }
  });
  return { merged, kept, skipped };
}

/** Restores merged copies to their state before consolidation (from the recorded history). */
export function revertOriginCwv(user: User, runId: string): { restored: number } {
  assertCan(user, "issue:review");
  const r = get<{ project_id: string }>("SELECT project_id FROM audit_runs WHERE id = ?", runId);
  if (!r) throw new Error("Audit not found.");
  assertProjectAccess(user, r.project_id);
  const dups = all<{ id: string }>("SELECT id FROM issues WHERE run_id = ? AND duplicate_of IS NOT NULL", runId);
  tx(() => {
    for (const d of dups) {
      const before = get<{ v: string | null }>("SELECT from_value AS v FROM issue_events WHERE issue_id = ? AND action = 'merged_duplicate' ORDER BY created_at DESC LIMIT 1", d.id)?.v ?? "unverified";
      run("UPDATE issues SET verification_status = ?, duplicate_of = NULL, updated_at = ? WHERE id = ?", before, new Date().toISOString(), d.id);
      logEvent(d.id, user, "unmerged", "false_positive", before, "Consolidation reverted");
    }
  });
  return { restored: dups.length };
}
