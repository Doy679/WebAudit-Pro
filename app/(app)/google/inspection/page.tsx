import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { searchConsoleStatus } from "@/server/google/gsc-status";
import { can } from "@/server/permissions";
import { googleTasks, inspections, projectGoogle } from "@/server/google/service";
import { listRuns, runPages } from "@/server/runs";
import { listIssues } from "@/server/issues";
import { queueInspectionAction } from "@/app/google-actions";
import { ActionForm, Submit } from "@/components/forms";
import { AutoRefresh } from "@/components/AutoRefresh";
import { GoogleTabs, ProjectPicker, Source, Unavailable, GscStatusNotice } from "@/components/google";
import { Card, cx, Empty, fmtDate, hint, input, label, Notice, PageHeader, shortUrl } from "@/components/ui";
import { selectProject } from "../shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "URL Inspection" };

const v = (x: string | null | undefined) => x || <Unavailable />;

export default async function InspectionPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { projects, project } = selectProject(user, sp.project);
  if (!project) return (<><PageHeader title="URL Inspection" /><Empty title="Add a website first" /></>);
  const pg = projectGoogle(user, project.id);
  const connected = !!(pg.gsc_property && pg.connection_id);
  const gsc = searchConsoleStatus(user, project.id);
  const rows = inspections(user, project.id);
  const pending = googleTasks(user, project.id, 50).filter((t) => t.type === "gsc_inspect" && (t.status === "pending" || t.status === "running")).length;
  const lastRun = listRuns(user, { projectId: project.id, status: "completed", limit: 1 })[0];
  const suggestions = lastRun ? runPages(lastRun.id).filter((p) => p.ok).map((p) => p.url).slice(0, Math.min(5, pg.inspection_max_urls)) : [];
  // WebAudit Pro's own live-crawl view of the same pages, for side-by-side comparison.
  const live = lastRun ? listIssues(user, { runId: lastRun.id, type: "seo", pageSize: 500 }).rows : [];
  const liveFor = (url: string) => live.filter((i) => i.pages.includes(url) && /canonical|noindex|http-error|redirect/.test(i.rule));

  return (
    <>
      <PageHeader title="URL Inspection" subtitle="What Google's index knows about a URL (Search Console URL Inspection API). This is not a live test of the page." />
      <GoogleTabs active="inspection" project={project.id} />
      {pending > 0 && <AutoRefresh everyMs={3000} />}
      <ProjectPicker projects={projects} selected={project.id} />

      {connected && gsc.state !== "ready" && <div className="mb-3"><GscStatusNotice status={gsc} /></div>}
      {!connected ? (
        <GscStatusNotice status={gsc} />
      ) : can(user, "audit:start") && (
        <Card title="Inspect URLs" className="mb-6">
          <ActionForm action={queueInspectionAction} className="space-y-3">
            <input type="hidden" name="projectId" value={project.id} />
            {lastRun && <input type="hidden" name="runId" value={lastRun.id} />}
            <div>
              <label htmlFor="urls" className={label}>URLs in {pg.gsc_property} (one per line)</label>
              <textarea id="urls" name="urls" rows={4} defaultValue={suggestions.join("\n")} className={`${input} mt-1 font-mono text-xs`} />
              <p className={hint}>At most {pg.inspection_max_urls} per request; Google allows 2,000 per property per day. Only URLs inside the property and the project&apos;s domain are accepted.</p>
            </div>
            <Submit>Inspect in Search Console</Submit>
          </ActionForm>
        </Card>
      )}
      {pending > 0 && <div className="mb-4"><Notice>{pending} inspection{pending === 1 ? "" : "s"} in progress…</Notice></div>}

      {rows.length === 0 ? <Empty title="No URLs inspected yet" /> : (
        <div className="space-y-4">
          {rows.map((r) => {
            const d = r.data;
            const mine = liveFor(r.key);
            return (
              <Card key={r.id} title={<span className="break-all">{shortUrl(r.key)}</span>} actions={d?.link ? <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-sm text-accent-600 underline">Open in Search Console ↗</a> : undefined}>
                {r.status === "error" ? <Notice tone="error">{r.error}</Notice> : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-2"><Source kind="gsc" when={r.fetched_at} /></div>
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm" data-testid="inspection-fields">
                        <dt className="text-slate-500">Verdict</dt><dd><span className={cx("rounded px-1.5 text-xs font-semibold", d.verdict === "PASS" ? "bg-ok-bg text-ok" : d.verdict === "FAIL" ? "bg-sev-high-bg text-sev-high" : "bg-slate-100")}>{v(d.verdict)}</span></dd>
                        <dt className="text-slate-500">Coverage</dt><dd>{v(d.coverageState)}</dd>
                        <dt className="text-slate-500">Last Google crawl</dt><dd>{d.lastCrawlTime ? fmtDate(d.lastCrawlTime) : <Unavailable />}{d.crawledAs ? ` (${d.crawledAs.toLowerCase()})` : ""}</dd>
                        <dt className="text-slate-500">Page fetch</dt><dd>{v(d.pageFetchState)}</dd>
                        <dt className="text-slate-500">Robots.txt</dt><dd>{v(d.robotsTxtState)}</dd>
                        <dt className="text-slate-500">Indexing allowed</dt><dd>{v(d.indexingState)}</dd>
                        <dt className="text-slate-500">Google-selected canonical</dt><dd className="break-all">{v(d.googleCanonical)}</dd>
                        <dt className="text-slate-500">User-declared canonical</dt><dd className="break-all">{v(d.userCanonical)}</dd>
                        <dt className="text-slate-500">Rich results</dt><dd>{d.richResults ? <>{d.richResults.verdict}: {d.richResults.items.map((i: { type: string; issues: unknown[] }) => `${i.type}${i.issues.length ? ` (${i.issues.length} issues)` : ""}`).join(", ") || "none"}</> : <Unavailable why="Google reported none" />}</dd>
                      </dl>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div className="mb-2"><Source kind="webaudit" when={lastRun?.created_at} /></div>
                      {!lastRun ? <p className="text-slate-500">No WebAudit Pro audit yet.</p> : mine.length ? (
                        <ul className="list-disc pl-5">{mine.map((i) => <li key={i.id}><Link className="text-accent-600 underline" href={`/issues/${i.id}`}>{i.code}</Link> {i.title}</li>)}</ul>
                      ) : <p className="text-slate-600">The latest live crawl found no canonical, noindex, redirect or HTTP problems on this URL.</p>}
                      <p className="mt-2 text-xs text-slate-500">Differences between the two columns usually mean the page changed since Google last crawled it.</p>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
