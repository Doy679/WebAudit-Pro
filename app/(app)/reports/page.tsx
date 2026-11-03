import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { listRuns } from "@/server/runs";
import { listExports } from "@/server/exports";
import { can } from "@/server/permissions";
import { createExportAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { AutoRefresh } from "@/components/AutoRefresh";
import { btn, Card, Empty, fmtDate, hint, input, label, PageHeader, StatusPill } from "@/components/ui";
import { CATEGORIES } from "@/components/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const FORMAT_LABEL = { xlsx: "Excel (.xlsx)", pdf: "PDF", html: "HTML", json: "JSON" } as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const user = await requireUser();
  const { run } = await searchParams;
  const runs = listRuns(user, { status: "completed", limit: 100 });
  const selected = runs.find((r) => r.id === run) ?? runs[0];
  const exports = listExports(user);
  const pending = exports.some((e) => e.status === "pending" || e.status === "running");

  return (
    <>
      <PageHeader title="Reports" subtitle="Excel for developers, PDF for clients, plus HTML and JSON. Generated from saved audit and review data." />
      {pending && <AutoRefresh everyMs={2000} />}

      {!selected ? (
        <Empty title="No completed audits yet">Reports are generated from a completed audit. <Link href="/audits/new" className="text-accent-600 underline">Start one</Link>.</Empty>
      ) : can(user, "export:create") ? (
        <Card title="Generate a report" className="mb-6">
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="run" className={label}>Audit</label>
              <select id="run" name="run" defaultValue={selected.id} className={`${input} mt-1`}>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.project_name}: {fmtDate(r.created_at)} ({r.findings} findings)</option>)}
              </select>
            </div>
            <button className={btn.secondary}>Select</button>
          </form>
          <ActionForm action={createExportAction} className="space-y-4" resetKey={selected.id}>
            <input type="hidden" name="runId" value={selected.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="kind" className={label}>Classification</label>
                <select id="kind" name="kind" className={`${input} mt-1`}>
                  <option value="">All</option><option value="confirmed">Confirmed only</option><option value="recommendation">Recommendations only</option><option value="needs-review">Needs review only</option>
                </select>
              </div>
              <div>
                <label htmlFor="severity" className={label}>Severity</label>
                <select id="severity" name="severity" className={`${input} mt-1`}>
                  <option value="">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </div>
              <div>
                <label htmlFor="type" className={label}>Category</label>
                <select id="type" name="type" className={`${input} mt-1`}>
                  <option value="">All</option>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="reviewedOnly" className="mt-1" />
              <span>Only internally reviewed findings (confirmed or approved)<span className={hint + " block"}>Recommended before sharing with a client. False positives are always left out.</span></span>
            </label>
            <div className="flex flex-wrap gap-2">
              {(["xlsx", "pdf", "html", "json"] as const).map((f) => (
                <Submit key={f} name="format" value={f} variant={f === "xlsx" || f === "pdf" ? "primary" : "secondary"}>Generate {FORMAT_LABEL[f]}</Submit>
              ))}
            </div>
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Generated reports">
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
                    <td className="py-2 pr-3"><StatusPill status={e.status} />{e.error && <div className="text-xs text-sev-high">{e.error}</div>}</td>
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
        ) : <p className="text-sm text-slate-500">No reports yet.</p>}
      </Card>
    </>
  );
}
