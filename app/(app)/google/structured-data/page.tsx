import Link from "next/link";
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

export default async function StructuredDataPage({ searchParams }: { searchParams: Promise<{ project?: string; run?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { projects, project } = selectProject(user, sp.project);
  if (!project) return (<><PageHeader title="Structured Data" /><Empty title="Add a website first" /></>);
  const runs = listRuns(user, { projectId: project.id, status: "completed", limit: 50 });
  const runRow = runs.find((r) => r.id === sp.run) ?? runs[0];
  const pages = runRow ? structuredData(user, runRow.id) : [];
  const indexed = new Map(inspections(user, project.id).filter((i) => i.status === "ok").map((i) => [i.key, i]));
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
        Internal validation (rules version {RULES_VERSION}) is not an official Google Rich Results Test result, and Google doesn&apos;t guarantee rich results even for eligible pages.
        Use <strong>Open in Google Rich Results Test</strong> to confirm. Google&apos;s own indexed status appears when Search Console URL inspection has been run.
      </Notice></div>

      {!runRow ? <Empty title="No completed audits yet">Run an audit with the Structured data category to check schema.</Empty> : pages.length === 0 ? (
        <Empty title="No structured data was checked in this audit">Either no pages contained structured data, or the audit ran without the Structured data category.</Empty>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">{pages.length} pages · {totals.items} items · <span className="text-sev-high">{totals.errors} errors</span> · <span className="text-sev-med">{totals.warnings} warnings</span> · <Link className="text-accent-600 underline" href={`/issues?run=${runRow.id}&type=structured-data`}>open as findings</Link></p>
          <div className="space-y-4">
            {pages.map((p) => {
              const insp = indexed.get(p.url);
              return (
                <Card key={p.url} title={<span className="break-all">{shortUrl(p.url)}</span>} actions={
                  <a href={richResultsTestUrl(p.url)} target="_blank" rel="noopener noreferrer" className={btn.secondary} data-testid="open-rrt">Open in Google Rich Results Test ↗</a>
                }>
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                    <Source kind="schema" when={p.checked_at} />
                    <span>Google-indexed rich results:</span>
                    {insp?.data?.richResults ? (
                      <span><Source kind="gsc" when={insp.fetched_at} /> verdict {insp.data.richResults.verdict ?? "n/a"}: {insp.data.richResults.items.map((i: { type: string }) => i.type).join(", ") || "none detected"}</span>
                    ) : <Unavailable why={insp ? "Google reported none" : "URL not inspected"} />}
                  </div>
                  <table className="w-full text-left text-sm">
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
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
