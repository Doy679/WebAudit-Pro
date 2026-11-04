import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { listRuns } from "@/server/runs";
import { exportPreview, listExports, reportCategories, type ExportFilters } from "@/server/exports";
import { can } from "@/server/permissions";
import { createExportAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { AutoRefresh } from "@/components/AutoRefresh";
import { btn, Card, cx, Empty, fmtDate, hint, input, label, PageHeader, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const FORMAT_LABEL = { xlsx: "Excel (.xlsx)", pdf: "PDF", html: "HTML", json: "JSON" } as const;

// Report types in plain language. "Selected issues" is any type limited to issues picked on the Issues page.
const TYPES = [
  { format: "xlsx", title: "Developer Excel report", who: "For your developers", text: "Every finding with page, selector, measurements, screenshot links and a tracker sheet to record fixes." },
  { format: "pdf", title: "Client PDF report", who: "For clients and managers", text: "A readable summary with scores, the most important findings and screenshots. Tip: include reviewed findings only." },
  { format: "html", title: "Detailed technical report", who: "For technical review", text: "A single web page with all findings and evidence, viewable in any browser." },
  { format: "json", title: "Data export (JSON)", who: "For integrations", text: "Machine-readable data for other tools." },
] as const;

type SP = { run?: string; kind?: string; severity?: string; type?: string; reviewed?: string; ids?: string | string[] };
const StepTitle = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900">
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-navy-900 text-[11px] text-white" aria-hidden="true">{n}</span>
    <span><span className="sr-only">Step {n}: </span>{children}</span>
  </h3>
);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const runs = listRuns(user, { status: "completed", limit: 100 });
  const selected = runs.find((r) => r.id === sp.run) ?? runs[0];
  const exports = listExports(user);
  const pending = exports.some((e) => e.status === "pending" || e.status === "running");
  // BUG-14: categories come from the selected audit itself (with counts), including Performance and Core Web Vitals.
  const categories = selected ? reportCategories(user, selected.id) : [];
  const ids = (Array.isArray(sp.ids) ? sp.ids : sp.ids ? [sp.ids] : []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 2000);
  const filters: ExportFilters = {
    kind: ["confirmed", "recommendation", "needs-review"].includes(sp.kind ?? "") ? sp.kind : undefined,
    severity: ["high", "medium", "low"].includes(sp.severity ?? "") ? sp.severity : undefined,
    type: categories.some((c) => c.value === sp.type) ? sp.type : undefined,
    reviewedOnly: sp.reviewed === "on",
    ids: ids.length ? ids : undefined,
  };
  const preview = selected ? exportPreview(user, selected.id, filters) : null;

  return (
    <>
      <PageHeader title="Reports" subtitle="Turn a finished audit into a downloadable report. Reports are created from saved audit and review data; nothing is sent to anyone automatically." />
      {pending && <AutoRefresh everyMs={2000} />}

      {!selected ? (
        <Empty title="No completed audits yet">Reports are made from a finished audit. <Link href="/audits/new" className="text-accent-600 underline">Start an audit</Link></Empty>
      ) : can(user, "export:create") ? (
        <Card title="Create a report" className="mb-6">
          <form method="get" className="space-y-5" aria-label="Report options">
            {ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <div>
              <StepTitle n={1}>Choose the audit</StepTitle>
              <label htmlFor="run" className="sr-only">Audit</label>
              <select id="run" name="run" defaultValue={selected.id} className={input}>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.project_name}: {fmtDate(r.created_at)} ({r.findings} findings)</option>)}
              </select>
            </div>

            <div>
              <StepTitle n={2}>Choose what to include</StepTitle>
              {ids.length > 0 && (
                <p className="mb-2 rounded-md bg-accent-50 px-3 py-2 text-sm text-navy-800" data-testid="selected-ids">
                  Custom report: only the {ids.length} issue{ids.length === 1 ? "" : "s"} you selected on the Issues page. <Link href={`/reports?run=${selected.id}`} className="text-accent-600 underline">Include all issues instead</Link>
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="kind" className={label}>Classification</label>
                  <select id="kind" name="kind" defaultValue={filters.kind ?? ""} className={`${input} mt-1`}>
                    <option value="">All</option><option value="confirmed">Confirmed only</option><option value="recommendation">Recommendations only</option><option value="needs-review">Needs review only</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="severity" className={label}>Severity</label>
                  <select id="severity" name="severity" defaultValue={filters.severity ?? ""} className={`${input} mt-1`}>
                    <option value="">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="type" className={label}>Category</label>
                  <select id="type" name="type" defaultValue={filters.type ?? ""} className={`${input} mt-1`}>
                    <option value="">All</option>{categories.map((c) => <option key={c.value} value={c.value}>{c.label} ({c.count})</option>)}
                  </select>
                </div>
              </div>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" name="reviewed" defaultChecked={filters.reviewedOnly} className="mt-1" />
                <span>Only internally reviewed findings (confirmed or approved)<span className={hint + " block"}>Recommended before sharing with a client. False positives are always left out.</span></span>
              </label>
              <button className={cx(btn.secondary, "mt-3")}>Update preview</button>
            </div>
          </form>

          {preview && (
            <div className="mt-5" data-testid="report-preview">
              <StepTitle n={3}>Preview</StepTitle>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm" aria-live="polite">
                {preview.total
                  ? <>The report will include <strong>{preview.total}</strong> finding{preview.total === 1 ? "" : "s"} from <strong>{selected.project_name}</strong>: {preview.high} high, {preview.medium} medium, {preview.low} low priority.</>
                  : <>No findings match these options, so the report would be empty. Change the options above{filters.reviewedOnly ? ", or review some findings first on the Issues page" : ""}.</>}
              </p>
            </div>
          )}

          <ActionForm action={createExportAction} className="mt-5" resetKey={`${selected.id}-${JSON.stringify(filters)}`}>
            <StepTitle n={4}>Choose the report type and create it</StepTitle>
            <input type="hidden" name="runId" value={selected.id} />
            {filters.kind && <input type="hidden" name="kind" value={filters.kind} />}
            {filters.severity && <input type="hidden" name="severity" value={filters.severity} />}
            {filters.type && <input type="hidden" name="type" value={filters.type} />}
            {filters.reviewedOnly && <input type="hidden" name="reviewedOnly" value="on" />}
            {ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <ul className="grid gap-3 md:grid-cols-2">
              {TYPES.map((t) => (
                <li key={t.format} className="flex flex-col justify-between gap-3 rounded-md border border-slate-200 p-3">
                  <div>
                    <div className="font-medium text-navy-900">{t.title}</div>
                    <div className="text-xs font-medium text-accent-600">{t.who}</div>
                    <p className="mt-1 text-sm text-slate-600">{t.text}</p>
                  </div>
                  <Submit name="format" value={t.format} variant={t.format === "xlsx" || t.format === "pdf" ? "primary" : "secondary"} className="self-start"
                    disabled={!preview?.total} title={!preview?.total ? "No findings match these options" : undefined}>
                    Generate {FORMAT_LABEL[t.format]}
                  </Submit>
                </li>
              ))}
            </ul>
            {!preview?.total && <p className="mt-2 text-sm font-medium text-sev-med" data-testid="empty-report-note">Generate is turned off because the report would be empty. Change the options in step 2.</p>}
            <p className={hint + " mt-2"}>Reports take a few seconds. When ready they appear under &quot;Your reports&quot; with a download link.</p>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Your reports">
        {exports.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm" data-testid="exports-table">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Created</th><th className="py-2 pr-3">Website</th><th className="py-2 pr-3">Format</th><th className="py-2 pr-3">Findings</th><th className="py-2 pr-3">Status</th><th className="py-2">Download</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {exports.map((e) => (
                  <tr key={e.id} data-format={e.format} data-status={e.status}>
                    <td className="py-2 pr-3">{fmtDate(e.created_at)}<div className="text-xs text-slate-500">{e.created_by_name}</div></td>
                    <td className="py-2 pr-3">{e.project_name}</td>
                    <td className="py-2 pr-3">{FORMAT_LABEL[e.format]}</td>
                    <td className="tabular py-2 pr-3">{e.issue_count ?? "–"}</td>
                    <td className="py-2 pr-3">
                      <StatusPill status={e.status} label={e.status === "pending" || e.status === "running" ? "Creating…" : undefined} />
                      {e.status === "failed" && (
                        <div className="mt-1 text-xs text-sev-high">
                          The report couldn&apos;t be created{e.error ? ` (${e.error})` : ""}. Your audit data is unchanged; try generating it again.
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      {e.status === "completed" ? (
                        <a href={`/api/exports/${e.id}`} className={btn.ghost} download data-testid={`download-${e.format}`}>
                          {e.file_name} ({Math.max(1, Math.round((e.size_bytes ?? 0) / 1024))} KB)
                        </a>
                      ) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-500">No reports yet. Create one above.</p>}
      </Card>
    </>
  );
}
