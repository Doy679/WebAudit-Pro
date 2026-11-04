import Link from "@/components/AppLink";
import { requireUser } from "@/app/lib/session";
import { searchConsoleStatus } from "@/server/google/gsc-status";
import { can } from "@/server/permissions";
import { googleTasks, latestGsc, projectGoogle } from "@/server/google/service";
import type { SitemapInfo } from "@/server/google/gsc";
import { queueSitemapsAction } from "@/app/google-actions";
import { ActionForm, Submit } from "@/components/forms";
import { AutoRefresh } from "@/components/AutoRefresh";
import { fmtNum, GoogleTabs, ProjectPicker, Source, Unavailable, GscStatusNotice } from "@/components/google";
import { Card, Empty, fmtDate, Notice, PageHeader } from "@/components/ui";
import { selectProject } from "../shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sitemaps" };

export default async function SitemapsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { projects, project } = selectProject(user, sp.project);
  if (!project) return (<><PageHeader title="Sitemaps" /><Empty title="Add a website first" /></>);
  const pg = projectGoogle(user, project.id);
  const connected = !!(pg.gsc_property && pg.connection_id);
  const gsc = searchConsoleStatus(user, project.id);
  const latest = latestGsc(user, project.id, "sitemaps");
  const pending = googleTasks(user, project.id, 20).some((t) => t.type === "gsc_sitemaps" && (t.status === "pending" || t.status === "running"));
  const sitemaps: SitemapInfo[] = latest?.status === "ok" ? latest.data.sitemaps : [];

  return (
    <>
      <PageHeader title="Sitemaps" subtitle="Sitemaps known to Google Search Console for this property. Read-only: WebAudit Pro never submits or deletes sitemaps." />
      <GoogleTabs active="sitemaps" project={project.id} />
      {pending && <AutoRefresh everyMs={3000} />}
      <ProjectPicker projects={projects} selected={project.id} />
      {connected && gsc.state !== "ready" && <div className="mb-3"><GscStatusNotice status={gsc} /></div>}
      {!connected ? (
        <GscStatusNotice status={gsc} />
      ) : (
        <>
          {can(user, "audit:start") && (
            <ActionForm action={queueSitemapsAction} className="mb-4">
              <input type="hidden" name="projectId" value={project.id} />
              <Submit>Refresh from Search Console</Submit>
            </ActionForm>
          )}
          {!latest ? <Empty title="Sitemap status not fetched yet" /> : latest.status === "error" ? <Notice tone="error">{latest.error}</Notice> : (
            <Card title={<span className="flex items-center gap-2">Sitemaps for {latest.property} <Source kind="gsc" when={latest.fetched_at} /></span>}>
              {sitemaps.length === 0 ? <p className="text-sm text-slate-600">Search Console reports no sitemaps for this property.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Sitemap</th><th className="pr-3">Status</th><th className="pr-3">Last submitted</th><th className="pr-3">Last downloaded</th><th className="pr-3 text-right">Errors</th><th className="pr-3 text-right">Warnings</th><th className="text-right">Submitted URLs</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {sitemaps.map((s) => (
                        <tr key={s.path}>
                          <td className="max-w-xs break-all py-2 pr-3">{s.path}{s.isSitemapsIndex ? <span className="ml-1 text-xs text-slate-500">(index)</span> : null}</td>
                          <td className="pr-3">{s.isPending ? "Pending" : "Processed"}</td>
                          <td className="pr-3 text-xs">{s.lastSubmitted ? fmtDate(s.lastSubmitted) : <Unavailable />}</td>
                          <td className="pr-3 text-xs">{s.lastDownloaded ? fmtDate(s.lastDownloaded) : <Unavailable />}</td>
                          <td className={`tabular pr-3 text-right ${s.errors ? "font-semibold text-sev-high" : ""}`}>{s.errors ?? "–"}</td>
                          <td className="tabular pr-3 text-right">{s.warnings ?? "–"}</td>
                          <td className="tabular text-right">{s.contents?.length ? s.contents.map((c) => `${fmtNum(c.submitted) ?? "?"} ${c.type}`).join(", ") : <Unavailable />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">Google no longer reports indexed counts per sitemap in this API; use Search Console&apos;s Pages report for indexing coverage.</p>
            </Card>
          )}
        </>
      )}
    </>
  );
}
