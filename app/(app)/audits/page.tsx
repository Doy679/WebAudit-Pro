import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { cancellationNote, listRuns } from "@/server/runs";
import { listProjects } from "@/server/projects";
import { can } from "@/server/permissions";
import { btn, cx, Empty, fmtDate, input, PageHeader, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Runs" };

const PAGE_SIZE = 25;
const STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;
const elapsed = (a: string | null, b: string | null) => {
  if (!a || !b) return "–";
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60} s`;
};

export default async function AuditsPage({ searchParams }: { searchParams: Promise<{ project?: string; status?: string; page?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const projects = listProjects(user);
  const projectId = projects.some((p) => p.id === sp.project) ? sp.project : undefined;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const all = listRuns(user, { projectId, status, limit: 1000 });
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(Math.max(Number(sp.page) || 1, 1), pages);
  const runs = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const link = (patch: Record<string, string | undefined>) =>
    `/audits?${new URLSearchParams(Object.entries({ project: projectId, status, ...patch }).filter(([, v]) => v) as [string, string][]).toString()}`;

  return (
    <>
      <PageHeader title="Audit Runs" subtitle="Every audit is kept with its settings, pages, findings and evidence. Times: Queued = when it was requested, Started = when scanning began, Finished = when it completed, failed or was cancelled."
        actions={can(user, "audit:start") ? <Link href="/audits/new" className={btn.primary}>New audit</Link> : undefined} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3" aria-label="Filter audits">
        <label className="block text-xs font-medium text-slate-600">Website
          <select name="project" defaultValue={projectId ?? ""} className={cx(input, "mt-1 py-1.5")}>
            <option value="">All websites</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">Status
          <select name="status" defaultValue={status ?? ""} className={cx(input, "mt-1 py-1.5")}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </label>
        <button className={btn.secondary}>Apply</button>
        <span className="text-sm text-slate-600">{all.length} audit{all.length === 1 ? "" : "s"}</span>
      </form>

      {runs.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Website</th><th className="px-4 py-2">Queued</th><th className="px-4 py-2">Started</th><th className="px-4 py-2">Finished</th>
                <th className="px-4 py-2">Duration</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Pages scanned</th><th className="px-4 py-2 text-right">Findings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => {
                const note = cancellationNote(r);
                return (
                  <tr key={r.id} className="align-top hover:bg-slate-50" data-testid="audit-row">
                    <td className="px-4 py-2"><Link className="text-accent-600 hover:underline" href={`/audits/${r.id}`}>{r.project_name}</Link></td>
                    <td className="whitespace-nowrap px-4 py-2">{fmtDate(r.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{r.started_at ? fmtDate(r.started_at) : <span className="text-slate-500">Not started</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2">{fmtDate(r.finished_at)}</td>
                    <td className="tabular px-4 py-2">{elapsed(r.started_at, r.finished_at)}</td>
                    <td className="px-4 py-2"><StatusPill status={r.status} />{note && <div className="mt-1 max-w-xs text-xs text-slate-600" data-testid="cancel-note">{note}</div>}</td>
                    <td className="tabular px-4 py-2 text-right">{r.pages_done}/{r.pages_total || "?"}{r.pages_failed ? ` (${r.pages_failed} failed)` : ""}</td>
                    <td className="tabular px-4 py-2 text-right">{r.status === "completed" ? r.findings : r.findings_raw ? <span title="Collected while scanning but not imported">{r.findings_raw} not imported</span> : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty title={projectId || status ? "No audits match these filters" : "No audits yet"} />}

      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-600">Page {page} of {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className={btn.secondary} href={link({ page: String(page - 1) })}>Previous</Link>}
            {page < pages && <Link className={btn.secondary} href={link({ page: String(page + 1) })}>Next</Link>}
          </span>
        </nav>
      )}
    </>
  );
}
