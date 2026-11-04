// BUG-05: whether a real-user (CrUX) finding describes one page or the whole website, decided from the stored
// PageSpeed result, plus a read-only dry run of consolidating whole-site findings (changing them needs approval).
import { all, get, safeJson } from "../db";
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
