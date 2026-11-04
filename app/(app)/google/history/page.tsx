import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { gscHistory, psiResults } from "@/server/google/service";
import { listRuns } from "@/server/runs";
import { all } from "@/server/db";
import { Delta, fmtNum, GoogleTabs, ProjectPicker, Score, Source, Unavailable } from "@/components/google";
import { btn, Card, Empty, fmtDate, PageHeader, shortUrl } from "@/components/ui";
import { selectProject } from "../shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO History & Reports" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { projects, project } = selectProject(user, sp.project);
  if (!project) return (<><PageHeader title="SEO History & Reports" /><Empty title="Add a website first" /></>);

  const psi = psiResults(user, { projectId: project.id, limit: 1000 }).filter((r) => r.result);
  const groups = new Map<string, typeof psi>();
  // One entry per real measurement: cache reuses copy Google's original timestamp, so they collapse here (BUG-04).
  const seen = new Set<string>();
  for (const r of psi) {
    const k = `${r.url}|${r.strategy}`;
    if (seen.has(`${k}|${r.fetched_at}`)) continue;
    seen.add(`${k}|${r.fetched_at}`);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const perf = gscHistory(user, project.id, "performance", 20).filter((h) => h.status === "ok");
  const insp = gscHistory(user, project.id, "inspection", 500).filter((h) => h.status === "ok");
  const byUrl = new Map<string, typeof insp>();
  for (const i of insp) byUrl.set(i.key, [...(byUrl.get(i.key) ?? []), i]);
  const runs = listRuns(user, { projectId: project.id, status: "completed", limit: 20 });
  const sd = all<{ run_id: string; pages: number; errors: number; warnings: number }>(
    `SELECT run_id, COUNT(*) AS pages, SUM(errors) AS errors, SUM(warnings) AS warnings FROM structured_data WHERE project_id = ? GROUP BY run_id`, project.id);
  const sdBy = new Map(sd.map((s) => [s.run_id, s]));

  return (
    <>
      <PageHeader title="SEO History & Reports" subtitle="How Google measurements changed over time. Every value keeps its source and timestamp." />
      <GoogleTabs active="history" project={project.id} />
      <ProjectPicker projects={projects} selected={project.id} />
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href={`/reaudit?project=${project.id}`} className={btn.secondary}>Compare audits (findings fixed / remaining / new)</Link>
        <Link href={`/reports${runs[0] ? `?run=${runs[0].id}` : ""}`} className={btn.secondary}>Generate Excel / PDF with Google data</Link>
      </div>

      <div className="space-y-6">
        <Card title={<span className="flex items-center gap-2">PageSpeed: first vs latest <Source kind="lab" /></span>}>
          {groups.size === 0 ? <p className="text-sm text-slate-500">No PageSpeed history yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Page</th><th className="pr-3">Device</th><th className="pr-3" title="Distinct Google measurements; cached reuses are not counted">Measurements</th><th className="pr-3">Perf. first → latest</th><th className="pr-3">LCP change</th><th className="pr-3">CLS change</th><th>Latest</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {[...groups.values()].map((rows) => {
                    const latest = rows[0], first = rows[rows.length - 1];
                    return (
                      <tr key={latest.id}>
                        <td className="max-w-xs truncate py-2 pr-3">{shortUrl(latest.url)}</td>
                        <td className="pr-3 capitalize">{latest.strategy}</td>
                        <td className="tabular pr-3">{rows.length}</td>
                        <td className="pr-3"><span className="inline-flex items-center gap-1"><Score value={first.result!.scores.performance} /> → <Score value={latest.result!.scores.performance} /></span> {rows.length > 1 && <Delta before={first.result!.scores.performance} after={latest.result!.scores.performance} noise={5} />}</td>
                        <td className="pr-3">{rows.length > 1 ? <Delta before={first.result!.lab.lcp?.value} after={latest.result!.lab.lcp?.value} unit=" ms" lowerIsBetter noise={(first.result!.lab.lcp?.value ?? 0) * 0.1} /> : "–"}</td>
                        <td className="pr-3">{rows.length > 1 ? <Delta before={first.result!.lab.cls?.value} after={latest.result!.lab.cls?.value} lowerIsBetter noise={0.02} /> : "–"}</td>
                        <td className="text-xs text-slate-500">{fmtDate(latest.analysis_ts ?? latest.fetched_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Lighthouse results vary between runs (network, server load, Google&apos;s test machines). Changes within about ±5 score points, ±10% LCP or ±0.02 CLS are labelled normal variation and shouldn&apos;t be read as an effect of website changes.</p>
            </div>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2">Search Console performance fetches <Source kind="gsc" /></span>}>
          {perf.length === 0 ? <p className="text-sm text-slate-500">No Search Console data yet.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Range</th><th className="pr-3 text-right">Clicks</th><th className="pr-3 text-right">vs previous period</th><th className="pr-3 text-right">Impressions</th><th className="pr-3 text-right">vs previous period</th><th>Fetched</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {perf.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 pr-3">{h.data.range.startDate} to {h.data.range.endDate}</td>
                    <td className="tabular pr-3 text-right">{fmtNum(h.data.totals.clicks)}</td>
                    <td className="pr-3 text-right"><Delta before={h.data.previous.totals.clicks} after={h.data.totals.clicks} /></td>
                    <td className="tabular pr-3 text-right">{fmtNum(h.data.totals.impressions)}</td>
                    <td className="pr-3 text-right"><Delta before={h.data.previous.totals.impressions} after={h.data.totals.impressions} /></td>
                    <td className="text-xs text-slate-500">{fmtDate(h.fetched_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2">Indexing status changes <Source kind="gsc" /></span>}>
          {byUrl.size === 0 ? <p className="text-sm text-slate-500">No URL inspections yet.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">URL</th><th className="pr-3">Previous</th><th className="pr-3">Latest</th><th>Last Google crawl</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {[...byUrl.entries()].map(([url, rows]) => (
                  <tr key={url}>
                    <td className="max-w-xs truncate py-2 pr-3">{shortUrl(url)}</td>
                    <td className="pr-3 text-xs">{rows[1] ? `${rows[1].data.coverageState ?? rows[1].data.verdict} (${fmtDate(rows[1].fetched_at)})` : <Unavailable />}</td>
                    <td className="pr-3 text-xs">{rows[0].data.coverageState ?? rows[0].data.verdict ?? <Unavailable />}{rows[1] && rows[1].data.coverageState !== rows[0].data.coverageState ? <strong className="ml-1 text-sev-med">changed</strong> : null}</td>
                    <td className="text-xs">{rows[0].data.lastCrawlTime ? fmtDate(rows[0].data.lastCrawlTime) : <Unavailable />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2">Structured data by audit <Source kind="schema" /></span>}>
          {runs.length === 0 ? <p className="text-sm text-slate-500">No audits yet.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Audit</th><th className="pr-3 text-right">Pages with schema</th><th className="pr-3 text-right">Errors</th><th className="text-right">Warnings</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => {
                  const s = sdBy.get(r.id);
                  return <tr key={r.id}><td className="py-2 pr-3"><Link className="text-accent-600 hover:underline" href={`/google/structured-data?project=${project.id}&run=${r.id}`}>{fmtDate(r.created_at)}</Link></td><td className="tabular pr-3 text-right">{s?.pages ?? <Unavailable />}</td><td className="tabular pr-3 text-right">{s?.errors ?? "–"}</td><td className="tabular text-right">{s?.warnings ?? "–"}</td></tr>;
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
