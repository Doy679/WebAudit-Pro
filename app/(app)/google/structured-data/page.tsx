import Link from "@/components/AppLink";
import { requireUser } from "@/app/lib/session";
import { listRuns } from "@/server/runs";
import { inspections, structuredData } from "@/server/google/service";
import { RULES_VERSION, richResultsTestUrl } from "@/src/schema/validate";
import { GoogleTabs, ProjectPicker, Source, Unavailable } from "@/components/google";
import { btn, Card, cx, Empty, fmtDate, input, Notice, PageHeader, shortUrl } from "@/components/ui";
import { selectProject } from "../shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Structured Data" };

const STATUS = { valid: ["Valid schema", "text-ok bg-ok-bg"], warnings: ["Valid, with warnings", "text-sev-med bg-sev-med-bg"], errors: ["Has errors", "text-sev-high bg-sev-high-bg"], invalid: ["Invalid (not parsed)", "text-sev-high bg-sev-high-bg"] } as const;
const ELIGIBILITY = {
  candidate: "Google feature candidate (internal check passed)",
  "missing-required": "Not eligible: missing or invalid required properties",
  "no-google-feature": "No Google rich result for this type",
  invalid: "Cannot be evaluated",
} as const;

export default async function StructuredDataPage({ searchParams }: { searchParams: Promise<{ project?: string; run?: string; only?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { projects, project } = selectProject(user, sp.project);
  if (!project) return (<><PageHeader title="Structured Data" /><Empty title="Add a website first" /></>);
  const runs = listRuns(user, { projectId: project.id, status: "completed", limit: 50 });
  const runRow = runs.find((r) => r.id === sp.run) ?? runs[0];
  const pages = runRow ? structuredData(user, runRow.id) : [];
  const indexed = new Map(inspections(user, project.id).filter((i) => i.status === "ok").map((i) => [i.key, i]));
  // UX-12: summary by type, repeated issues across pages, and an errors-only view.
  const onlyErrors = sp.only === "errors";
  const byType = new Map<string, { pages: Set<string>; items: number; errors: number; warnings: number; doc?: string }>();
  const repeated = new Map<string, { label: string; severity: string; pages: Set<string>; doc?: string }>();
  for (const p of pages) for (const it of p.items) {
    const t = it.types.join(", ") || "(no @type)";
    const row = byType.get(t) ?? { pages: new Set<string>(), items: 0, errors: 0, warnings: 0, doc: it.issues.find((i) => i.docUrl)?.docUrl };
    row.pages.add(p.url); row.items++;
    row.errors += it.issues.filter((i) => i.severity === "error").length;
    row.warnings += it.issues.filter((i) => i.severity !== "error").length;
    byType.set(t, row);
    for (const i of it.issues) {
      const key = `${t}|${i.severity}|${i.property}|${i.message}`;
      const r = repeated.get(key) ?? { label: `${t}: ${i.message}`, severity: i.severity, pages: new Set<string>(), doc: i.docUrl };
      r.pages.add(p.url);
      repeated.set(key, r);
    }
  }
  const repeatedList = [...repeated.values()].filter((r) => r.pages.size > 1).sort((a, b) => (a.severity === "error" ? -1 : 1) - (b.severity === "error" ? -1 : 1) || b.pages.size - a.pages.size);
  const shownPages = onlyErrors ? pages.filter((p) => p.errors > 0) : pages;
  const totals = pages.reduce((t, p) => ({ items: t.items + p.items.length, errors: t.errors + p.errors, warnings: t.warnings + p.warnings }), { items: 0, errors: 0, warnings: 0 });

  return (
    <>
      <PageHeader title="Structured Data / Rich Results" subtitle="JSON-LD, microdata and RDFa found during WebAudit Pro audits, checked against Google's documented requirements." />
      <GoogleTabs active="structured-data" project={project.id} />
      <ProjectPicker projects={projects} selected={project.id} extra={runs.length > 0 && (
        <div className="min-w-0 sm:w-72">
          <label htmlFor="run" className="block text-sm font-medium text-slate-700">Audit</label>
          <select id="run" name="run" defaultValue={runRow?.id} className={`${input} mt-1`}>{runs.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.created_at)}</option>)}</select>
        </div>
      )} />
      <div className="mb-4"><Notice>
        Internal validation (current rules version {RULES_VERSION}; each page shows the version it was checked with) is not an official Google Rich Results Test result, and Google doesn&apos;t guarantee rich results even for eligible pages.
        Use <strong>Open in Google Rich Results Test</strong> to confirm. Google&apos;s own indexed status appears when Search Console URL inspection has been run.
      </Notice></div>

      {pages.some((p) => p.rules_version < "2026-11-04") && (
        <div className="mb-4"><Notice tone="warn">
          This audit was checked with older rules ({[...new Set(pages.map((p) => p.rules_version.split(" ")[0]))].join(", ")}). Those rules could report one empty value
          (for example <code>datePublished: &quot;&quot;</code>) as both &quot;missing&quot; and &quot;wrong type&quot;, and could call an Article &quot;not eligible&quot;.
          The current rules ({RULES_VERSION.split(" ")[0]}) give one verdict per property; the next audit uses them. Stored results are shown as recorded.
        </Notice></div>
      )}
      {!runRow ? <Empty title="No completed audits yet">Run an audit with the Structured data category to check schema.</Empty> : pages.length === 0 ? (
        <Empty title="No structured data was checked in this audit">Either no pages contained structured data, or the audit ran without the Structured data category.</Empty>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">{pages.length} pages · {totals.items} items · <span className="text-sev-high">{totals.errors} errors</span> · <span className="text-sev-med">{totals.warnings} warnings</span> · <Link className="text-accent-600 underline" href={`/issues?run=${runRow.id}&type=structured-data`}>open as findings</Link></p>

          <Card title="Summary by type" className="mb-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm" data-testid="sd-summary">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-1 pr-3">Type</th><th className="pr-3 text-right">Pages</th><th className="pr-3 text-right">Items</th><th className="pr-3 text-right">Errors</th><th className="pr-3 text-right">Warnings</th><th>Google docs</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {[...byType.entries()].sort((a, b) => b[1].errors - a[1].errors || b[1].items - a[1].items).map(([t, r]) => (
                    <tr key={t}>
                      <td className="py-1.5 pr-3 font-medium">{t}</td><td className="tabular pr-3 text-right">{r.pages.size}</td><td className="tabular pr-3 text-right">{r.items}</td>
                      <td className={cx("tabular pr-3 text-right", r.errors > 0 && "font-semibold text-sev-high")}>{r.errors}</td><td className="tabular pr-3 text-right">{r.warnings}</td>
                      <td>{r.doc ? <a href={r.doc} target="_blank" rel="noopener noreferrer" className="text-accent-600 underline">rules</a> : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {repeatedList.length > 0 && (
              <details className="mt-3 text-sm" data-testid="sd-repeated">
                <summary className="cursor-pointer font-medium text-navy-900">Same issue on several pages ({repeatedList.length})</summary>
                <ul className="mt-2 space-y-1">
                  {repeatedList.slice(0, 30).map((r) => (
                    <li key={r.label + r.severity}>
                      <span className={r.severity === "error" ? "text-sev-high" : "text-sev-med"}>{r.severity === "error" ? "Error" : "Warning"}</span> {r.label} <span className="text-slate-500">· {r.pages.size} pages</span>
                      {r.doc && <> · <a className="text-accent-600 underline" href={r.doc} target="_blank" rel="noopener noreferrer">docs</a></>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Which pages to show">
            <Link href={`/google/structured-data?project=${project.id}&run=${runRow.id}`} aria-current={!onlyErrors ? "page" : undefined}
              className={cx("rounded-full border px-3 py-1", !onlyErrors ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white")}>All pages ({pages.length})</Link>
            <Link href={`/google/structured-data?project=${project.id}&run=${runRow.id}&only=errors`} aria-current={onlyErrors ? "page" : undefined} data-testid="sd-errors-only"
              className={cx("rounded-full border px-3 py-1", onlyErrors ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white")}>Pages with errors ({pages.filter((p) => p.errors > 0).length})</Link>
            <span className="text-slate-500">Each page below is collapsed; pages with errors start open.</span>
          </div>
          <div className="space-y-4">
            {shownPages.map((p) => {
              const insp = indexed.get(p.url);
              return (
                <details key={p.url} open={p.errors > 0 || shownPages.length === 1} className="rounded-lg border border-slate-200 bg-white" data-testid="sd-page">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="break-all font-semibold text-navy-900">{shortUrl(p.url)}</span>
                  <span className="text-xs text-slate-600">{p.items.length} item{p.items.length === 1 ? "" : "s"} · <span className={p.errors ? "font-semibold text-sev-high" : ""}>{p.errors} errors</span> · {p.warnings} warnings</span>
                </summary>
                <Card className="border-0 border-t" actions={
                  <a href={richResultsTestUrl(p.url)} target="_blank" rel="noopener noreferrer" className={btn.secondary} data-testid="open-rrt">Open in Google Rich Results Test ↗</a>
                }>
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                    <Source kind="schema" when={p.checked_at} />
                    <span className="text-slate-600" data-testid="sd-rules-version">Checked with rules {p.rules_version.split(" ")[0]}</span>
                    <span>Google-indexed rich results:</span>
                    {insp?.data?.richResults ? (
                      <span><Source kind="gsc" when={insp.fetched_at} /> verdict {insp.data.richResults.verdict ?? "n/a"}: {insp.data.richResults.items.map((i: { type: string }) => i.type).join(", ") || "none detected"}</span>
                    ) : <Unavailable why={insp ? "Google reported none" : "URL not inspected"} />}
                  </div>
                  {p.items.length === 0 ? <p className="text-sm text-slate-600" data-testid="sd-empty">No structured data found on this page.</p> : (
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500"><tr><th className="py-1 pr-3">Type</th><th className="pr-3">Format</th><th className="pr-3">Schema validity</th><th className="pr-3">Google candidate check</th><th>Issues</th></tr></thead>
                    <tbody className="divide-y divide-slate-100 align-top">
                      {p.items.map((it, n) => (
                        <tr key={n}>
                          <td className="py-2 pr-3 font-medium">{it.types.join(", ") || "(no @type)"}{it.name && <div className="text-xs font-normal text-slate-500">{it.name}</div>}</td>
                          <td className="pr-3 text-xs">{it.format}<div className="text-slate-400">{it.source}</div></td>
                          <td className="pr-3"><span className={cx("rounded px-1.5 py-0.5 text-xs font-medium", STATUS[it.status][1])}>{STATUS[it.status][0]}</span></td>
                          <td className="pr-3 text-xs">{it.googleFeature ? <strong>{it.googleFeature}: </strong> : null}{ELIGIBILITY[it.eligibility]}{it.eligibility === "candidate" ? <div className="text-slate-500">Needs manual Rich Results Test verification</div> : null}</td>
                          <td className="text-xs">
                            {it.issues.length === 0 ? "None" : (
                              <ul className="space-y-1">
                                {it.issues.slice(0, 8).map((i, k) => (
                                  <li key={k}>
                                    <span className={i.severity === "error" ? "text-sev-high" : "text-sev-med"}>{i.severity === "error" ? "Error" : "Warning"}</span>{" "}
                                    <code>{i.property}</code>: {i.message}{i.expected ? <span className="text-slate-500"> (expected {i.expected})</span> : null}
                                    {i.docUrl && <> · <a className="text-accent-600 underline" href={i.docUrl} target="_blank" rel="noopener noreferrer">docs</a></>}
                                  </li>
                                ))}
                                {it.issues.length > 8 && <li className="text-slate-500">+{it.issues.length - 8} more in Issues</li>}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  )}
                </Card>
                </details>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
