import Link from "@/components/AppLink";
import { requireUser } from "@/app/lib/session";
import { overviewStats, recentActivity, websiteSummaries } from "@/server/stats";
import { onboardingState } from "@/server/onboarding";
import { workerStatus } from "@/server/worker-status";
import { googleStatus } from "@/server/google/config";
import { searchConsoleStatus } from "@/server/google/gsc-status";
import { pageSpeedHealth } from "@/server/google/health-status";
import { can } from "@/server/permissions";
import { setOnboardingAction } from "@/app/actions";
import { btn, Card, cx, Empty, fmtDate, Notice, PageHeader, StatusPill } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

function Attention({ icon, label, value, help, href, tone }: { icon: IconName; label: string; value: number; help: string; href: string; tone?: "high" }) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 hover:border-accent-500">
      <span className={cx("mt-0.5 rounded-md p-2", tone === "high" && value ? "bg-sev-high-bg text-sev-high" : "bg-navy-50 text-navy-800")}><Icon name={icon} /></span>
      <span className="min-w-0">
        <span className={cx("tabular block text-2xl font-semibold", tone === "high" && value ? "text-sev-high" : "text-navy-900")}>{value}</span>
        <span className="block text-sm font-medium text-navy-900 group-hover:underline">{label}</span>
        <span className="block text-xs text-slate-500">{help}</span>
      </span>
    </Link>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const s = overviewStats(user);
  const sites = websiteSummaries(user);
  const activity = recentActivity(user, 8);
  const guide = onboardingState(user);
  const guideOpen = !guide.dismissed && guide.steps.some((x) => !x.done);
  const worker = workerStatus();
  const google = googleStatus();
  const gsc = searchConsoleStatus(user);
  const psi = pageSpeedHealth(user);
  const starter = can(user, "audit:start");

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="What needs your attention across your websites. Counts come from each website's latest completed audit."
        actions={starter ? <Link href="/audits/new" className={cx(btn.primary, "px-5 py-2.5")}><Icon name="play" className="h-4 w-4" />Start new audit</Link> : undefined}
      />
      {error === "forbidden" && <div className="mb-4"><Notice tone="warn">Your role doesn&apos;t have access to that page. Ask an admin if you need it.</Notice></div>}

      {guideOpen && (
        <section aria-labelledby="guide-title" className="mb-6 rounded-lg border border-accent-500/40 bg-accent-50 p-4" data-testid="getting-started">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="guide-title" className="font-semibold text-navy-900">Welcome to WebAudit Pro</h2>
              <p className="text-sm text-slate-700">Five steps from adding a website to a client-approved list of fixes. Audits only read the website; nothing on it is changed.</p>
            </div>
            <form action={setOnboardingAction}><button className={btn.ghost}>Hide this guide</button></form>
          </div>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {guide.steps.map((step, n) => (
              <li key={step.key}>
                <Link href={step.href} className={cx("flex h-full gap-2 rounded-md border bg-white p-3 text-sm hover:border-accent-500", step.done ? "border-green-300" : "border-slate-200")}>
                  <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", step.done ? "bg-ok text-white" : "bg-navy-900 text-white")}>
                    {step.done ? <Icon name="check" className="h-4 w-4" /> : n + 1}
                  </span>
                  <span>
                    <span className="block font-medium text-navy-900">{step.label}{step.done && <span className="sr-only"> (done)</span>}</span>
                    <span className="block text-xs text-slate-600">{step.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-600">Need more detail? See <Link href="/help" className="text-accent-600 underline">Help &amp; getting started</Link>.</p>
        </section>
      )}

      <h2 className="sr-only">Needs attention</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Attention icon="alert" label="High-priority findings" value={s.highPriority} help="Fix these first" href="/issues?quick=high" tone="high" />
        <Attention icon="eye" label="Needs your review" value={s.needsReview} help="Possible problems to confirm or dismiss" href="/review" />
        <Attention icon="users" label="Awaiting client decision" value={s.awaitingClient} help={`${s.pendingApprovals} open approval link${s.pendingApprovals === 1 ? "" : "s"}`} href="/issues?quick=client" />
        <Attention icon="file" label="Reports ready" value={s.reportsReady} help="Excel and PDF downloads" href="/reports" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="My websites" actions={<Link href="/projects" className={btn.ghost}>Manage websites</Link>}>
          {sites.length ? (
            <ul className="divide-y divide-slate-100" data-testid="dashboard-websites">
              {sites.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/projects/${w.id}`} className="font-medium text-navy-900 hover:underline">{w.name}</Link>
                    <div className="break-all text-xs text-slate-500">{w.domain}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      {w.active ? (
                        <Link href={`/audits/${w.active.id}`} className="inline-flex items-center gap-1 text-accent-600 hover:underline">
                          <StatusPill status={w.active.status} /> {w.active.status === "pending" ? "Waiting to start" : `${w.active.pages_done}/${w.active.pages_total || "?"} pages`}
                        </Link>
                      ) : w.lastRunId ? (
                        <>Last audit finished {fmtDate(w.lastAuditAt)} · {w.findings} findings{w.high ? <>, <span className="font-semibold text-sev-high">{w.high} high priority</span></> : null}</>
                      ) : "Not audited yet"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {w.lastRunId && <Link href={`/issues?run=${w.lastRunId}&quick=high`} className={btn.secondary}>View issues</Link>}
                    {starter && !w.active && <Link href={`/audits/new?project=${w.id}`} className={btn.secondary}>{w.lastRunId ? "Audit again" : "Start audit"}</Link>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No websites yet">
              {can(user, "project:create")
                ? <>Add a website you&apos;re authorized to audit. <Link className="text-accent-600 underline" href="/projects/new">Add your first website</Link></>
                : "Ask an admin or project manager to add you to a website."}
            </Empty>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="System status">
            <ul className="space-y-3 text-sm">
              <li className="flex gap-3" data-testid="dashboard-worker" data-state={worker.state}>
                <span className={cx("mt-0.5 rounded-md p-1.5", worker.state === "online" ? "bg-ok-bg text-ok" : "bg-sev-med-bg text-sev-med")}><Icon name="server" className="h-4 w-4" /></span>
                <span><span className="block font-medium text-navy-900">{worker.label}</span><span className="block text-xs text-slate-600">{worker.detail}</span></span>
              </li>
              <li className="flex gap-3" data-testid="dashboard-google">
                <span className={cx("mt-0.5 rounded-md p-1.5", psi.state === "ok" && gsc.state === "ready" ? "bg-ok-bg text-ok" : psi.state === "failing" || gsc.state === "api-error" ? "bg-sev-high-bg text-sev-high" : "bg-slate-100 text-slate-600")}><Icon name="search" className="h-4 w-4" /></span>
                <span>
                  <span className="block font-medium text-navy-900">Google SEO &amp; Performance</span>
                  <span className="block text-xs text-slate-600">
                    <span className={cx("block", psi.state === "failing" && "font-medium text-sev-high")} data-testid="dashboard-psi" data-state={psi.state}>{psi.label}</span>
                    <span className={cx("block", gsc.state === "api-error" && "font-medium text-sev-high")} data-testid="dashboard-gsc" data-state={gsc.state}>Search Console: {gsc.label}</span>
                    {psi.state !== "ok" || gsc.state !== "ready" ? "Audits still work; missing Google data is shown as unavailable, never estimated. " : ""}
                    <Link href="/google/connections" className="text-accent-600 underline">Connections</Link>
                  </span>
                </span>
              </li>
            </ul>
          </Card>
          <Card title="Recent activity" actions={<Link href="/audits" className={btn.ghost}>All audits</Link>}>
            {activity.length ? (
              <ul className="divide-y divide-slate-100">
                {activity.map((a, i) => (
                  <li key={i} className="py-2 text-sm">
                    <Link href={a.href} className="block text-navy-800 hover:underline">{a.label}</Link>
                    <span className="tabular text-xs text-slate-500">{fmtDate(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">Nothing yet. Activity appears here once you start auditing.</p>}
          </Card>
        </div>
      </div>
      {guide.dismissed && guide.steps.some((x) => !x.done) && (
        <form action={setOnboardingAction} className="mt-6 text-center"><input type="hidden" name="show" value="1" /><button className={btn.ghost}>Show the getting-started guide</button></form>
      )}
    </>
  );
}
