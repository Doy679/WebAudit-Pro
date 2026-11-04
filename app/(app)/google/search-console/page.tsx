import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { searchConsoleStatus } from "@/server/google/gsc-status";
import { can } from "@/server/permissions";
import { googleTasks, gscHistory, presetRange, projectGoogle } from "@/server/google/service";
import { queueGscPerformanceAction } from "@/app/google-actions";
import { ActionForm, Submit } from "@/components/forms";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Delta, fmtNum, fmtPct, GoogleTabs, ProjectPicker, Source, Unavailable, GscStatusNotice } from "@/components/google";
import { Card, Empty, fmtDate, input, label, Notice, PageHeader, shortUrl } from "@/components/ui";
import { selectProject } from "../shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search Console Performance" };

interface Row { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
interface Totals { clicks: number; impressions: number; ctr: number; position: number | null }

export default async function SearchConsolePage({ searchParams }: { searchParams: Promise<{ project?: string; id?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { projects, project } = selectProject(user, sp.project);
  if (!project) return (<><PageHeader title="Search Console Performance" /><Empty title="Add a website first" /></>);
  const pg = projectGoogle(user, project.id);
  const history = gscHistory(user, project.id, "performance", 30);
  const shown = history.find((h) => h.id === sp.id) ?? history.find((h) => h.status === "ok") ?? history[0];
  const pending = googleTasks(user, project.id, 30).some((t) => t.type === "gsc_performance" && (t.status === "pending" || t.status === "running"));
  const connected = !!(pg.gsc_property && pg.connection_id);
  const gsc = searchConsoleStatus(user, project.id);
  const d = shown?.status === "ok" ? shown.data : null;
  const r28 = presetRange(28);

  return (
    <>
      <PageHeader title="Search Console Performance" subtitle="Clicks, impressions, CTR and position from Google Search Console. Search traffic is context, not a technical defect." />
      <GoogleTabs active="search-console" project={project.id} />
      {pending && <AutoRefresh everyMs={3000} />}
      <ProjectPicker projects={projects} selected={project.id} />

      {connected && gsc.state !== "ready" && <div className="mb-3"><GscStatusNotice status={gsc} /></div>}
      {!connected ? (
        <GscStatusNotice status={gsc} />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">Property <strong>{pg.gsc_property}</strong> · via {pg.connection_owner}&apos;s Google connection</p>
          {can(user, "audit:start") && (
            <Card title="Fetch data" className="mb-6">
              <ActionForm action={queueGscPerformanceAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="projectId" value={project.id} />
                <div>
                  <label htmlFor="preset" className={label}>Date range</label>
                  <select id="preset" name="preset" defaultValue="28" className={`${input} mt-1`}>
                    <option value="7">Last 7 days</option><option value="28">Last 28 days</option><option value="90">Last 3 months</option><option value="custom">Custom…</option>
                  </select>
                </div>
                <div><label htmlFor="startDate" className={label}>Custom start</label><input id="startDate" name="startDate" type="date" defaultValue={r28.startDate} className={`${input} mt-1`} /></div>
                <div><label htmlFor="endDate" className={label}>Custom end</label><input id="endDate" name="endDate" type="date" defaultValue={r28.endDate} className={`${input} mt-1`} /></div>
                <Submit>Fetch from Search Console</Submit>
              </ActionForm>
              <p className="mt-2 text-xs text-slate-500">Ranges end 3 days ago because Google&apos;s most recent data is still being processed. Each fetch is compared with the previous period of the same length. Results are cached for 6 hours.</p>
            </Card>
          )}

          {!shown ? <Empty title="No Search Console data fetched yet" /> : shown.status === "error" ? (
            <Notice tone="error">The last request failed ({fmtDate(shown.fetched_at)}): {shown.error}</Notice>
          ) : d && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Source kind="gsc" when={shown.fetched_at} />
                <span>{d.range.startDate} to {d.range.endDate}, compared with {d.previous.range.startDate} to {d.previous.range.endDate}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="gsc-totals">
                {(([["Clicks", d.totals.clicks, d.previous.totals.clicks, fmtNum], ["Impressions", d.totals.impressions, d.previous.totals.impressions, fmtNum], ["Average CTR", d.totals.ctr, d.previous.totals.ctr, fmtPct], ["Average position", d.totals.position, d.previous.totals.position, (n: number | null) => (n === null ? null : n.toFixed(1))]]) as [string, number | null, number | null, (n: number | null) => string | null][]).map(([name, v, before, fmt]) => (
                  <div key={name} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <div className="tabular text-2xl font-semibold text-navy-900">{fmt(v) ?? <Unavailable />}</div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{name}</div>
                    <Delta before={before} after={v} lowerIsBetter={name === "Average position"} noise={0} />
                  </div>
                ))}
              </div>
              <Card title="Daily clicks"><Trend rows={d.byDate} previous={d.previous.byDate} /></Card>
              <div className="grid gap-6 xl:grid-cols-2">
                <RowsCard title="Top pages" rows={d.pages} first="Page" format={(k) => shortUrl(k)} />
                <RowsCard title="Top queries" rows={d.queries} first="Query" />
                <RowsCard title="By device" rows={d.devices} first="Device" />
                <RowsCard title="Search appearance" rows={d.appearance} first="Appearance" empty="Google reported no special search appearances for this range." />
              </div>
              <p className="text-xs text-slate-500">{d.notes}</p>
            </div>
          )}

          {history.length > 1 && (
            <Card title="Earlier fetches" className="mt-6">
              <ul className="text-sm">{history.map((h) => <li key={h.id}><Link className="text-accent-600 hover:underline" href={`/google/search-console?project=${project.id}&id=${h.id}`}>{h.key.replace("_", " to ")}</Link> <span className="text-xs text-slate-500">fetched {fmtDate(h.fetched_at)}{h.status === "error" ? " · failed" : ""}</span></li>)}</ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function RowsCard({ title, rows, first, format, empty }: { title: string; rows: Row[]; first: string; format?: (k: string) => string; empty?: string }) {
  return (
    <Card title={title}>
      {rows.length ? (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500"><tr><th className="py-1 pr-2">{first}</th><th className="pr-2 text-right">Clicks</th><th className="pr-2 text-right">Impr.</th><th className="pr-2 text-right">CTR</th><th className="text-right">Pos.</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r, i) => (
            <tr key={i}><td className="max-w-[16rem] truncate py-1.5 pr-2">{format ? format(r.keys?.[0] ?? "") : r.keys?.[0]}</td><td className="tabular pr-2 text-right">{fmtNum(r.clicks)}</td><td className="tabular pr-2 text-right">{fmtNum(r.impressions)}</td><td className="tabular pr-2 text-right">{fmtPct(r.ctr)}</td><td className="tabular text-right">{r.position.toFixed(1)}</td></tr>
          ))}</tbody>
        </table>
      ) : <p className="text-sm text-slate-500">{empty ?? "No rows returned by Google for this range."}</p>}
    </Card>
  );
}

/** Daily clicks, current period vs previous (drawn to scale with one y axis). */
function Trend({ rows, previous }: { rows: Row[]; previous: Row[] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No daily data returned.</p>;
  const W = 640, H = 140, P = 28;
  const max = Math.max(1, ...rows.map((r) => r.clicks), ...previous.map((r) => r.clicks));
  const path = (data: Row[]) => data.map((r, i) => `${i ? "L" : "M"}${(P + (i / Math.max(1, data.length - 1)) * (W - 2 * P)).toFixed(1)},${(H - P - (r.clicks / max) * (H - 2 * P)).toFixed(1)}`).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full min-w-[480px]" role="img" aria-label="Daily clicks, current versus previous period">
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="#e4e7ec" />
        <text x={4} y={P} fontSize="10" fill="#667085">{max}</text>
        <text x={4} y={H - P} fontSize="10" fill="#667085">0</text>
        {previous.length > 1 && <path d={path(previous)} fill="none" stroke="#98a2b3" strokeDasharray="4 3" strokeWidth="1.5" />}
        <path d={path(rows)} fill="none" stroke="#2563c9" strokeWidth="2" />
        <text x={P} y={H - 8} fontSize="10" fill="#667085">{rows[0].keys?.[0]}</text>
        <text x={W - P} y={H - 8} fontSize="10" fill="#667085" textAnchor="end">{rows[rows.length - 1].keys?.[0]}</text>
      </svg>
      <p className="text-xs text-slate-500"><span className="text-accent-600">━</span> current period · <span className="text-slate-400">┅</span> previous period (aligned by day)</p>
    </div>
  );
}
