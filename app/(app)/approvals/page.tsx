import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { listRuns } from "@/server/runs";
import { listIssues, quickFilterCounts, releasableIssues } from "@/server/issues";
import { listPackages } from "@/server/approvals";
import { can } from "@/server/permissions";
import { createApprovalAction } from "@/app/actions";
import { ActionForm, SelectAll, Submit } from "@/components/forms";
import { btn, Card, Empty, fmtDate, hint, input, label, PageHeader, SeverityBadge, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client Approvals" };

const packageStatus = (p: { revoked_at: string | null; expires_at: string; submitted_at: string | null }) =>
  p.revoked_at ? "Revoked" : p.expires_at < new Date().toISOString() ? "Expired" : p.submitted_at ? "Decisions received" : "Awaiting client";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const user = await requireUser();
  const { run } = await searchParams;
  const packages = listPackages(user);
  const manage = can(user, "approval:manage");
  const runs = manage ? listRuns(user, { status: "completed", limit: 100 }) : [];
  const selected = runs.find((r) => r.id === run) ?? runs[0];
  const eligible = selected
    ? releasableIssues(user, selected.id)
    : [];
  // UX-07: say how far review has got and where the next findings to review are.
  const review = selected ? quickFilterCounts(user, { runId: selected.id }) : null;
  const unreviewedHigh = selected ? listIssues(user, { runId: selected.id, severity: "high", verification: "unverified", pageSize: 1 }).total : 0;

  return (
    <>
      <PageHeader
        title="Client Approvals"
        subtitle="Release internally reviewed findings to a client through a private, expiring link. Client decisions update review records only; the website is never changed."
      />

      {manage && selected && (
        <Card title="New approval package" className="mb-6">
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="run" className={label}>Audit</label>
              <select id="run" name="run" defaultValue={selected.id} className={`${input} mt-1`}>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.project_name}: {fmtDate(r.created_at)}</option>)}
              </select>
            </div>
            <button className={btn.secondary}>Select</button>
          </form>
          {eligible.length === 0 ? (
            <div className="space-y-2 text-sm text-slate-700" data-testid="approval-blocked">
              <p><strong>0 of {review?.all ?? 0}</strong> findings in this audit are ready to send. Only findings your team has reviewed can go to a client: confirm real problems, or approve recommendations.</p>
              {unreviewedHigh > 0 && (
                <p><Link href={`/issues?run=${selected.id}&severity=high&verification=unverified`} className="font-medium text-accent-600 underline">Review the {unreviewedHigh} high-priority findings first →</Link></p>
              )}
              <p><Link href={`/issues?run=${selected.id}&verification=unverified`} className="text-accent-600 underline">See all findings not reviewed yet</Link></p>
            </div>
          ) : (
            <ActionForm action={createApprovalAction} className="space-y-4" resetKey={selected.id}>
              <input type="hidden" name="projectId" value={selected.project_id} />
              <input type="hidden" name="runId" value={selected.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label htmlFor="title" className={label}>Title</label>
                  <input id="title" name="title" required defaultValue={`${selected.project_name}: audit findings for approval`} className={`${input} mt-1`} />
                </div>
                <div>
                  <label htmlFor="expiresInDays" className={label}>Link expires after (days)</label>
                  <input id="expiresInDays" name="expiresInDays" type="number" min={1} max={90} defaultValue={14} className={`${input} mt-1`} />
                </div>
              </div>
              <div>
                <label htmlFor="message" className={label}>Message to the client (optional)</label>
                <textarea id="message" name="message" rows={2} className={`${input} mt-1`} />
              </div>
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr><th className="w-8 px-3 py-2"><SelectAll name="ids" /></th><th className="px-3 py-2">Finding</th><th className="px-3 py-2">Severity</th><th className="px-3 py-2">Review</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {eligible.map((i) => (
                      <tr key={i.id}>
                        <td className="px-3 py-2"><input type="checkbox" name="ids" value={i.id} defaultChecked aria-label={`Release ${i.code}`} /></td>
                        <td className="px-3 py-2"><span className="font-mono text-xs text-slate-500">{i.code}</span> {i.title}</td>
                        <td className="px-3 py-2"><SeverityBadge severity={i.severity} /></td>
                        <td className="px-3 py-2"><StatusPill status={i.verification_status} /> <StatusPill status={i.review_status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={hint}>
                Only findings that were confirmed or approved internally are listed. The link is shown once after creation; share it with the client yourself. Nothing is emailed automatically.
              </p>
              <Submit>Create private approval link</Submit>
            </ActionForm>
          )}
        </Card>
      )}

      <Card title="Approval packages">
        {packages.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="py-2 pr-3">Package</th><th className="py-2 pr-3">Website</th><th className="py-2 pr-3">Findings</th><th className="py-2 pr-3">Decided</th><th className="py-2 pr-3">Expires</th><th className="py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {packages.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/approvals/${p.id}`} className="text-accent-600 hover:underline">{p.title}</Link>
                      <div className="text-xs text-slate-500">{p.created_by_name} · {fmtDate(p.created_at)}</div>
                    </td>
                    <td className="py-2 pr-3">{p.project_name}</td>
                    <td className="tabular py-2 pr-3">{p.items}</td>
                    <td className="tabular py-2 pr-3">{p.decided}</td>
                    <td className="py-2 pr-3">{fmtDate(p.expires_at)}</td>
                    <td className="py-2">{packageStatus(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No approval packages yet" />}
      </Card>
    </>
  );
}
