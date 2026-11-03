// Google data for reports, read from stored results only. Each block says where it came from and when,
// or why it's missing ("No data: …") so reports never imply a source ran when it didn't.
import { all, get } from "../db";
import type { FieldData, PsiResult, Strategy } from "../google/types";
import type { Inspection, SitemapInfo } from "../google/gsc";
import type { SdItem } from "../../src/schema/types";
import { psiReportUrl } from "../google/psi";

export interface GooglePsiRow { url: string; strategy: Strategy; status: string; error: string | null; fetchedAt: string; result: PsiResult | null; crux: FieldData | null; reportUrl: string }

export interface GoogleReportData {
  psi: GooglePsiRow[];
  psiNote: string | null;
  structured: { url: string; items: SdItem[]; rulesVersion: string; checkedAt: string }[];
  structuredNote: string | null;
  gsc: {
    property: string | null;
    note: string | null;
    performance: { fetchedAt: string; linkedToRun: boolean; data: any } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
    inspections: { url: string; fetchedAt: string; data: Inspection }[];
    sitemaps: { fetchedAt: string; sitemaps: SitemapInfo[] } | null;
  };
}

export function loadGoogleReportData(projectId: string, runId: string): GoogleReportData {
  // Latest PageSpeed result per URL + device that is linked to this audit.
  const psiRows = all<{ url: string; strategy: Strategy; status: string; error: string | null; fetched_at: string; result_json: string | null; crux_json: string | null }>(
    `SELECT p.* FROM psi_results p WHERE p.run_id = ? AND p.rowid = (SELECT x.rowid FROM psi_results x WHERE x.run_id = p.run_id AND x.url = p.url AND x.strategy = p.strategy ORDER BY x.fetched_at DESC, x.rowid DESC LIMIT 1) ORDER BY p.url, p.strategy`, runId);
  const psi = psiRows.map((r) => ({
    url: r.url, strategy: r.strategy, status: r.status, error: r.error, fetchedAt: r.fetched_at,
    result: r.result_json ? JSON.parse(r.result_json) : null, crux: r.crux_json ? JSON.parse(r.crux_json) : null, reportUrl: psiReportUrl(r.url, r.strategy),
  }));

  const settings = JSON.parse(get<{ s: string }>("SELECT settings_json AS s FROM audit_runs WHERE id = ?", runId)?.s ?? "{}") as { categories?: string[] };
  const sdRan = !settings.categories?.length || settings.categories.includes("structured-data");
  const structured = all<{ url: string; items_json: string; rules_version: string; checked_at: string }>("SELECT url, items_json, rules_version, checked_at FROM structured_data WHERE run_id = ? ORDER BY url", runId)
    .map((r) => ({ url: r.url, items: JSON.parse(r.items_json) as SdItem[], rulesVersion: r.rules_version, checkedAt: r.checked_at }));

  const pg = get<{ gsc_property: string | null; connection_id: string | null }>("SELECT gsc_property, connection_id FROM project_google WHERE project_id = ?", projectId);
  const latest = (kind: string) =>
    get<{ data_json: string; fetched_at: string; run_id: string | null }>(
      `SELECT data_json, fetched_at, run_id FROM gsc_data WHERE project_id = ? AND kind = ? AND status = 'ok' ORDER BY (run_id = ?) DESC, fetched_at DESC LIMIT 1`, projectId, kind, runId);
  const perf = latest("performance");
  const sm = latest("sitemaps");
  const inspections = all<{ key: string; data_json: string; fetched_at: string }>(
    `SELECT g.key, g.data_json, g.fetched_at FROM gsc_data g WHERE g.project_id = ? AND g.kind = 'inspection' AND g.status = 'ok'
     AND g.rowid = (SELECT x.rowid FROM gsc_data x WHERE x.project_id = g.project_id AND x.kind = 'inspection' AND x.key = g.key AND x.status = 'ok' ORDER BY x.fetched_at DESC, x.rowid DESC LIMIT 1)
     ORDER BY g.key`, projectId).map((r) => ({ url: r.key, fetchedAt: r.fetched_at, data: JSON.parse(r.data_json) as Inspection }));

  const connected = !!(pg?.gsc_property && pg.connection_id);
  return {
    psi,
    psiNote: psi.length ? null : "PageSpeed Insights was not run for this audit.",
    structured,
    structuredNote: !sdRan ? "Structured data was not included in this audit." : structured.length ? null : "No structured data was found on the scanned pages.",
    gsc: {
      property: pg?.gsc_property ?? null,
      note: !connected && !perf && !inspections.length ? "Search Console is not connected for this website." : null,
      performance: perf ? { fetchedAt: perf.fetched_at, linkedToRun: perf.run_id === runId, data: JSON.parse(perf.data_json) } : null,
      inspections,
      sitemaps: sm ? { fetchedAt: sm.fetched_at, sitemaps: JSON.parse(sm.data_json).sitemaps } : null,
    },
  };
}
