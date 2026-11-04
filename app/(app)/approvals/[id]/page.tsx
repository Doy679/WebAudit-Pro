import Link from "@/components/AppLink";
import { notFound } from "next/navigation";
import { requireUser } from "@/app/lib/session";
import { listPackages, packageDecisions } from "@/server/approvals";
import { all } from "@/server/db";
import { can } from "@/server/permissions";
import { revokeApprovalAction } from "@/app/actions";
import { btn, Card, fmtDate, PageHeader, SeverityBadge, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ApprovalPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const pkg = listPackages(user).find((p) => p.id === id);
  if (!pkg) notFound();
  const decisions = packageDecisions(user, id);
  const items = all<{ id: string; code: string; title: string; severity: string }>(
    "SELECT i.id, i.code, i.title, i.severity FROM approval_items ai JOIN issues i ON i.id = ai.issue_id WHERE ai.package_id = ? ORDER BY i.code", id);
  const active = !pkg.revoked_at && pkg.expires_at > new Date().toISOString();

  return (
    <>
      <div className="mb-2 text-sm"><Link href="/approvals" className="text-accent-600 hover:underline">← Client Approvals</Link></div>
      <PageHeader
        title={pkg.title}
        subtitle={<>{pkg.project_name} · created by {pkg.created_by_name} {fmtDate(pkg.created_at)} · {pkg.revoked_at ? `revoked ${fmtDate(pkg.revoked_at)}` : `expires ${fmtDate(pkg.expires_at)}`}</>}
        actions={active && can(user, "approval:manage") ? (
          <form action={revokeApprovalAction}>
            <input type="hidden" name="packageId" value={id} />
            <button className={btn.danger}>Revoke link</button>
          </form>
        ) : undefined}
      />
      <p className="mb-4 text-sm text-slate-600">
        For security the link itself is not stored and can&apos;t be shown again. If the client lost it, revoke this package and create a new one.
      </p>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`Released findings (${items.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/issues/${i.id}`} className="text-navy-800 hover:underline"><span className="font-mono text-xs text-slate-500">{i.code}</span> {i.title}</Link>
                <SeverityBadge severity={i.severity} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Client decisions (audit trail)">
          {decisions.length ? (
            <ul className="space-y-3 text-sm" data-testid="decision-log">
              {decisions.map((d, n) => (
                <li key={n} className="border-l-2 border-accent-500 pl-3">
                  <div><span className="font-mono text-xs text-slate-500">{d.code}</span> <StatusPill status={d.decision} /></div>
                  <div className="text-xs text-slate-500">{d.client_name} &lt;{d.client_email}&gt; · {fmtDate(d.created_at)}</div>
                  {d.comment && <p className="mt-1 text-slate-700">“{d.comment}”</p>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">No decisions submitted yet.</p>}
        </Card>
      </div>
    </>
  );
}
