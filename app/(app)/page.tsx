import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { overviewStats, recentActivity } from "@/server/stats";
import { listRuns } from "@/server/runs";
import { can } from "@/server/permissions";
import { btn, Card, Empty, fmtDate, Notice, PageHeader, Stat, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const s = overviewStats(user);
  const activity = recentActivity(user);
  const running = listRuns(user, { limit: 50 }).filter((r) => r.status === "running" || r.status === "pending");

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Totals across your websites. Findings are counted from each website's latest completed audit, excluding false positives."
        actions={can(user, "audit:start") ? <Link href="/audits/new" className={btn.primary}>New audit</Link> : undefined}
      />
      {error === "forbidden" && <div className="mb-4"><Notice tone="warn">Your role doesn't have access to that page.</Notice></div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Projects" value={s.projects} href="/projects" />
        <Stat label="Completed audits" value={s.completedAudits} href="/audits" />
        <Stat label="Running audits" value={s.runningAudits} href="/audits" />
        <Stat label="Pages scanned" value={s.pagesScanned} />
        <Stat label="Pending client approvals" value={s.pendingApprovals} href="/approvals" />
        <Stat label="Confirmed issues" value={s.confirmed} href="/issues?kind=confirmed" />
        <Stat label="Recommendations" value={s.recommendations} href="/issues?kind=recommendation" />
        <Stat label="Needs review" value={s.needsReview} href="/issues?kind=needs-review" />
        <Stat label="High priority" value={s.highPriority} href="/issues?severity=high" tone={s.highPriority ? "high" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Recent activity">
          {activity.length ? (
            <ul className="divide-y divide-slate-100">
              {activity.map((a, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <Link href={a.href} className="min-w-0 text-navy-800 hover:underline">{a.label}</Link>
                  <span className="tabular shrink-0 text-xs text-slate-500">{fmtDate(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No activity yet">
              {s.projects ? <>Start an audit from <Link className="text-accent-600 underline" href="/audits/new">New Audit</Link>.</> : <>Add your first website under <Link className="text-accent-600 underline" href="/projects/new">My Websites</Link>.</>}
            </Empty>
          )}
        </Card>
        <Card title="Audits in progress">
          {running.length ? (
            <ul className="space-y-2">
              {running.map((r) => (
                <li key={r.id} className="text-sm">
                  <Link href={`/audits/${r.id}`} className="font-medium text-navy-800 hover:underline">{r.project_name}</Link>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <StatusPill status={r.status} /> {r.pages_done}/{r.pages_total || "?"} pages
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">No audits running.</p>}
        </Card>
      </div>
    </>
  );
}
