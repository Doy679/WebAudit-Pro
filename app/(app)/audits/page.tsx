import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { listRuns } from "@/server/runs";
import { can } from "@/server/permissions";
import { btn, Empty, fmtDate, PageHeader, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Runs" };

export default async function AuditsPage() {
  const user = await requireUser();
  const runs = listRuns(user, { limit: 200 });
  return (
    <>
      <PageHeader title="Audit Runs" subtitle="Every audit is kept with its settings, pages, findings and evidence."
        actions={can(user, "audit:start") ? <Link href="/audits/new" className={btn.primary}>New audit</Link> : undefined} />
      {runs.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-2">Started</th><th className="px-4 py-2">Website</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Pages</th><th className="px-4 py-2 text-right">Findings</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2"><Link className="text-accent-600 hover:underline" href={`/audits/${r.id}`}>{fmtDate(r.created_at)}</Link></td>
                  <td className="px-4 py-2">{r.project_name}</td>
                  <td className="px-4 py-2"><StatusPill status={r.status} /></td>
                  <td className="tabular px-4 py-2 text-right">{r.pages_done}{r.pages_total ? `/${r.pages_total}` : ""}{r.pages_failed ? ` (${r.pages_failed} failed)` : ""}</td>
                  <td className="tabular px-4 py-2 text-right">{r.status === "completed" ? r.findings : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title="No audits yet" />}
    </>
  );
}
