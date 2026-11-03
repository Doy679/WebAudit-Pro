import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { can } from "@/server/permissions";
import { googleStatus } from "@/server/google/config";
import { projectGoogle, psiResults, googleTasks, type PsiRow } from "@/server/google/service";
import { fmtFieldValue } from "@/server/google/psi";
import { listRuns, runPages } from "@/server/runs";
import { queuePsiAction } from "@/app/google-actions";
import { ActionForm, Submit } from "@/components/forms";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CwvBadge, Delta, GoogleTabs, ProjectPicker, Score, Source, Unavailable } from "@/components/google";
import { btn, Card, Empty, fmtDate, hint, input, label, Notice, PageHeader, shortUrl } from "@/components/ui";
import { selectProject } from "../shared";
import type { FieldData, LhAudit } from "@/server/google/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "PageSpeed Insights" };

const LAB: [keyof NonNullable<PsiRow["result"]>["lab"], string][] = [["lcp", "LCP"], ["fcp", "FCP"], ["cls", "CLS"], ["tbt", "TBT"], ["si", "Speed Index"]];
const FIELD: ["lcp" | "inp" | "cls" | "fcp" | "ttfb", string][] = [["lcp", "LCP"], ["inp", "INP"], ["cls", "CLS"], ["fcp", "FCP"], ["ttfb", "TTFB"]];

export default async function PageSpeedPage({ searchParams }: { searchParams: Promise<{ project?: string; id?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { projects, project } = selectProject(user, sp.project);
  if (!project) return (<><PageHeader title="PageSpeed Insights" /><Empty title="Add a website first" /></>);
  const status = googleStatus();
  const pg = projectGoogle(user, project.id);
  const all = psiResults(user, { projectId: project.id, limit: 500 });
  const pending = googleTasks(user, project.id, 50).filter((t) => t.type === "psi" && (t.status === "pending" || t.status === "running"));
  const latest = [...new Map(all.map((r) => [`${r.url}|${r.strategy}`, r])).values()]; // newest first per URL + device
  const lastRun = listRuns(user, { projectId: project.id, status: "completed", limit: 1 })[0];
  const suggested = lastRun ? runPages(lastRun.id).filter((p) => p.ok).map((p) => p.url).slice(0, Math.min(5, pg.psi_max_urls)) : [project.base_url];
  const detail = sp.id ? all.find((r) => r.id === sp.id) : undefined;

  return (
    <>
      <PageHeader title="PageSpeed Insights" subtitle="Google Lighthouse lab scores and, when Google has them, real-user Chrome UX Report data. Results come from Google's API." />
      <GoogleTabs active="pagespeed" project={project.id} />
      {pending.length > 0 && <AutoRefresh everyMs={4000} />}
      <ProjectPicker projects={projects} selected={project.id} />

      {detail ? <PsiDetail row={detail} history={all.filter((r) => r.url === detail.url && r.strategy === detail.strategy)} project={project.id} /> : (
        <>
          {!status.apiKeyConfigured && <div className="mb-4"><Notice tone="warn">PageSpeed Insights is not configured. An admin can add a Google API key in <Link className="underline" href="/google/connections">Google Connections</Link>. Without it, no PageSpeed data is shown.</Notice></div>}
          {can(user, "audit:start") && status.apiKeyConfigured && (
            <Card title="Analyse pages" className="mb-6">
              <ActionForm action={queuePsiAction} className="space-y-3">
                <input type="hidden" name="projectId" value={project.id} />
                {lastRun && <input type="hidden" name="runId" value={lastRun.id} />}
                <div>
                  <label htmlFor="urls" className={label}>URLs (one per line, on {project.domain})</label>
                  <textarea id="urls" name="urls" rows={4} defaultValue={suggested.join("\n")} className={`${input} mt-1 font-mono text-xs`} />
                  <p className={hint}>Pre-filled from the latest audit. At most {pg.psi_max_urls} URLs per request for this project. Each URL and device is one API request (about 10–40 s).{lastRun ? " Results are linked to the latest audit, so they appear in its findings and reports." : ""}</p>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-1"><input type="checkbox" name="strategy" value="mobile" defaultChecked /> Mobile</label>
                  <label className="flex items-center gap-1"><input type="checkbox" name="strategy" value="desktop" defaultChecked /> Desktop</label>
                  <label className="flex items-center gap-1"><input type="checkbox" name="force" /> Skip the 6-hour cache</label>
                </div>
                <Submit>Run PageSpeed Insights</Submit>
              </ActionForm>
            </Card>
          )}
          {pending.length > 0 && <div className="mb-4"><Notice>{pending.length} request{pending.length === 1 ? "" : "s"} waiting at Google… this page refreshes automatically.</Notice></div>}

          <Card title="Latest results">
            {latest.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm" data-testid="psi-table">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr><th className="py-2 pr-3">Page</th><th className="pr-3">Device</th><th className="pr-3">Perf.</th><th className="pr-3">A11y</th><th className="pr-3">Best pr.</th><th className="pr-3">SEO</th><th className="pr-3">LCP (lab)</th><th className="pr-3">CLS (lab)</th><th className="pr-3">TBT (lab)</th><th className="pr-3">Real users</th><th>Analysed</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {latest.map((r) => (
                      <tr key={r.id}>
                        <td className="max-w-[16rem] truncate py-2 pr-3"><Link className="text-accent-600 hover:underline" href={`/google/pagespeed?project=${project.id}&id=${r.id}`}>{shortUrl(r.url)}</Link></td>
                        <td className="pr-3 capitalize">{r.strategy}</td>
                        {r.result ? (
                          <>
                            <td className="pr-3"><Score value={r.result.scores.performance} /></td>
                            <td className="pr-3"><Score value={r.result.scores.accessibility} /></td>
                            <td className="pr-3"><Score value={r.result.scores.bestPractices} /></td>
                            <td className="pr-3"><Score value={r.result.scores.seo} /></td>
                            <td className="pr-3 tabular">{r.result.lab.lcp?.display ?? <Unavailable />}</td>
                            <td className="pr-3 tabular">{r.result.lab.cls?.display ?? <Unavailable />}</td>
                            <td className="pr-3 tabular">{r.result.lab.tbt?.display ?? <Unavailable />}</td>
                            <td className="pr-3"><CwvBadge category={(r.crux ?? r.result.field)?.overall ?? worst(r.crux ?? r.result.field)} /></td>
                          </>
                        ) : <td colSpan={8} className="pr-3 text-xs text-sev-high">Unavailable: {r.error}</td>}
                        <td className="text-xs text-slate-500">{fmtDate(r.analysis_ts ?? r.fetched_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty title="No PageSpeed results yet" />}
          </Card>
        </>
      )}
    </>
  );
}

const worst = (f: FieldData | null | undefined) => {
  const cats = Object.values(f?.metrics ?? {}).map((m) => m.category);
  return cats.includes("poor") ? "poor" : cats.includes("needs-improvement") ? "needs-improvement" : cats.length ? "good" : null;
};

function PsiDetail({ row, history, project }: { row: PsiRow; history: PsiRow[]; project: string }) {
  const r = row.result;
  const field = row.crux ?? r?.field ?? null;
  const prev = history.filter((h) => h.result && h.id !== row.id && (h.analysis_ts ?? h.fetched_at) < (row.analysis_ts ?? row.fetched_at))[0];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/google/pagespeed?project=${project}`} className="text-accent-600 hover:underline">← All results</Link>
        <span className="font-medium">{row.url}</span><span className="capitalize">· {row.strategy}</span>
        <a href={row.reportUrl} target="_blank" rel="noopener noreferrer" className={btn.secondary} data-testid="open-psi">Open in PageSpeed Insights ↗</a>
      </div>
      {!r ? <Notice tone="error">Google returned no result: {row.error}</Notice> : (
        <>
          <Card title={<span className="flex flex-wrap items-center gap-2">Lighthouse scores <Source kind="lab" when={r.analysisTimestamp} /> <span className="text-xs font-normal text-slate-500">Lighthouse {r.lighthouseVersion}</span></span>}>
            <div className="flex flex-wrap gap-6">
              {([["Performance", r.scores.performance, prev?.result?.scores.performance], ["Accessibility", r.scores.accessibility, prev?.result?.scores.accessibility], ["Best Practices", r.scores.bestPractices, prev?.result?.scores.bestPractices], ["SEO", r.scores.seo, prev?.result?.scores.seo]] as const).map(([name, v, before]) => (
                <div key={name} className="text-center">
                  <Score value={v} label={name} />
                  <div className="mt-1 text-xs text-slate-600">{name}</div>
                  {prev && <Delta before={before} after={v} noise={5} />}
                </div>
              ))}
            </div>
            {prev && <p className="mt-3 text-xs text-slate-500">Compared with {fmtDate(prev.analysis_ts ?? prev.fetched_at)}. Lighthouse scores vary between runs; changes of about ±5 points are normal variation.</p>}
            {r.runWarnings.length > 0 && <div className="mt-3"><Notice tone="warn">Lighthouse warnings: {r.runWarnings.join(" · ")}</Notice></div>}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title={<span className="flex items-center gap-2">Lab metrics <Source kind="lab" /></span>}>
              <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
                {LAB.map(([k, name]) => {
                  const m = r.lab[k];
                  return <tr key={k}><td className="py-1.5 text-slate-600">{name}</td><td className="tabular font-medium">{m ? m.display : <Unavailable />}</td><td className="text-right">{prev?.result?.lab[k] && m ? <Delta before={prev.result.lab[k]!.value} after={m.value} unit={m.unit === "ms" ? " ms" : ""} lowerIsBetter noise={m.unit === "ms" ? m.value * 0.1 : 0.02} /> : null}</td></tr>;
                })}
              </tbody></table>
            </Card>
            <Card title={<span className="flex items-center gap-2">Core Web Vitals (real users) <Source kind="field" /></span>}>
              {field ? (
                <>
                  <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
                    {FIELD.map(([k, name]) => {
                      const m = field.metrics[k];
                      return <tr key={k}><td className="py-1.5 text-slate-600">{name}</td><td className="tabular font-medium">{m ? fmtFieldValue(m) : <Unavailable />}</td><td>{m ? <CwvBadge category={m.category} /> : null}</td></tr>;
                    })}
                  </tbody></table>
                  <p className="mt-2 text-xs text-slate-500">
                    Source: {field.source === "crux-api" ? "Chrome UX Report API" : "PageSpeed Insights (CrUX)"} · {field.scope === "origin" ? "whole-site (origin) data: this URL has too little traffic for its own" : "this URL"}{field.period ? ` · ${field.period}` : " · previous 28 days"}.
                  </p>
                </>
              ) : <p className="text-sm text-slate-600"><Unavailable /> Google has no real-user data for this URL (not enough Chrome traffic), or it wasn&apos;t returned. Lab metrics still apply.</p>}
            </Card>
          </div>

          <Card title={`Opportunities (${r.opportunities.length})`}>
            <p className="mb-3 text-xs text-slate-500">Estimated savings are Lighthouse&apos;s own estimates. These are recommendations, not confirmed malfunctions.</p>
            <AuditList audits={r.opportunities} />
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title={`Diagnostics (${r.diagnostics.length})`}><AuditList audits={r.diagnostics} /></Card>
            <Card title="Failed checks">
              {(["accessibility", "bestPractices", "seo"] as const).map((k) => (
                <div key={k} className="mb-3">
                  <h3 className="text-xs font-semibold uppercase text-slate-500">{k === "bestPractices" ? "Best practices" : k === "seo" ? "SEO" : "Accessibility"} ({r.failedChecks[k].length})</h3>
                  <ul className="mt-1 list-disc pl-5 text-sm">{r.failedChecks[k].map((a) => <li key={a.id}>{a.title} <code className="text-xs text-slate-400">{a.id}</code></li>)}</ul>
                </div>
              ))}
              <p className="text-xs text-slate-500">Accessibility and SEO checks are also covered by WebAudit Pro&apos;s own engine; they are shown here for reference and not duplicated as findings.</p>
            </Card>
          </div>
          <Card title="History for this URL and device">
            <table className="w-full text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-1 text-left">Analysed</th><th>Perf.</th><th>LCP</th><th>CLS</th><th>TBT</th><th></th></tr></thead>
              <tbody className="divide-y divide-slate-100">{history.map((h) => (
                <tr key={h.id}><td className="py-1.5 text-xs">{fmtDate(h.analysis_ts ?? h.fetched_at)}</td>
                  {h.result ? <><td className="text-center"><Score value={h.result.scores.performance} /></td><td className="text-center tabular">{h.result.lab.lcp?.display ?? "–"}</td><td className="text-center tabular">{h.result.lab.cls?.display ?? "–"}</td><td className="text-center tabular">{h.result.lab.tbt?.display ?? "–"}</td></> : <td colSpan={4} className="text-xs text-sev-high">{h.error}</td>}
                  <td className="text-right">{h.id !== row.id && <Link className="text-xs text-accent-600" href={`/google/pagespeed?project=${project}&id=${h.id}`}>Open</Link>}</td></tr>
              ))}</tbody></table>
          </Card>
        </>
      )}
    </div>
  );
}

function AuditList({ audits }: { audits: LhAudit[] }) {
  if (!audits.length) return <p className="text-sm text-slate-500">None reported.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {audits.map((a) => (
        <li key={a.id} className="py-2 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-navy-900">{a.title}</span>
            <span className="text-xs text-sev-med">{a.displayValue ?? ""}</span>
          </div>
          <div className="text-xs text-slate-500">Lighthouse audit <code>{a.id}</code>{a.metricSavings ? ` · affects ${Object.keys(a.metricSavings).join(", ")}` : ""}</div>
          {a.items.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {a.items.map((i, n) => <li key={n} className="truncate">{i.url ?? "(inline)"}{i.wastedBytes ? ` · ${Math.round(i.wastedBytes / 1024)} KiB` : ""}{i.wastedMs ? ` · ${Math.round(i.wastedMs)} ms` : ""}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
