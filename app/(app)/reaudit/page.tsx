import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { listProjects } from "@/server/projects";
import { listRuns } from "@/server/runs";
import { compareProjectRuns, type CompareStatus } from "@/server/compare";
import { all } from "@/server/db";
import { can } from "@/server/permissions";
import { evidenceUrl } from "@/server/files";
import { startAuditAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { btn, Card, cx, Empty, fmtDate, input, label, Notice, PageHeader, SeverityBadge, shortUrl, STATUS_LABEL, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Re-Audit" };

const ORDER: CompareStatus[] = ["new", "reopened", "changed", "still_present", "unable_to_verify", "resolved"];
const MAX_IMAGE_ROWS = 30;

export default async function ReauditPage({ searchParams }: { searchParams: Promise<{ project?: string; base?: string; latest?: string; status?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const projects = listProjects(user);
  const allRuns = listRuns(user, { status: "completed", limit: 200 });
  const fromRun = allRuns.find((r) => r.id === sp.latest || r.id === sp.base);
  const projectId = sp.project ?? fromRun?.project_id ?? projects[0]?.id;
  const project = projects.find((p) => p.id === projectId);
  const runs = allRuns.filter((r) => r.project_id === projectId);
  const latest = runs.find((r) => r.id === sp.latest) ?? runs[0];
  const base = runs.find((r) => r.id === sp.base) ?? runs.find((r) => latest && r.created_at < latest.created_at);

  let comparison: ReturnType<typeof compareProjectRuns> | null = null;
  let compareError: string | null = null;
  if (base && latest && base.id !== latest.id) {
    try {
      comparison = compareProjectRuns(user, base.id, latest.id);
    } catch (e) {
      compareError = (e as Error).message;
    }
  }

  const rows = comparison ? comparison.rows.filter((r) => !sp.status || r.status === sp.status) : [];
  const ids = rows.slice(0, MAX_IMAGE_ROWS).flatMap((r) => [r.baseIssue?.id, r.latestIssue?.id]).filter((x): x is string => !!x);
  const evidence = new Map(
    (ids.length ? all<{ id: string; run_id: string; evidence_json: string }>(`SELECT id, run_id, evidence_json FROM issues WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids) : [])
      .map((r) => [r.id, { runId: r.run_id, annotated: (JSON.parse(r.evidence_json) as { annotated?: string }).annotated }]));
  const shot = (id?: string) => {
    const e = id ? evidence.get(id) : undefined;
    return e?.annotated ? evidenceUrl(e.runId, e.annotated) : undefined;
  };
  const lastSettings = latest?.settings;

  return (
    <>
      <PageHeader title="Re-Audit" subtitle="After approved fixes are made (separately), run a fresh read-only scan and compare it with an earlier audit." />

      {!projects.length ? <Empty title="No websites yet" /> : (
        <>
          <Card className="mb-6">
            <form method="get" className="grid gap-3 md:grid-cols-4 md:items-end">
              <div>
                <label htmlFor="project" className={label}>Website</label>
                <select id="project" name="project" defaultValue={projectId} className={`${input} mt-1`}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="base" className={label}>Base audit (before)</label>
                <select id="base" name="base" defaultValue={base?.id} className={`${input} mt-1`}>
                  {runs.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.created_at)} ({r.findings})</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="latest" className={label}>Comparison audit (after)</label>
                <select id="latest" name="latest" defaultValue={latest?.id} className={`${input} mt-1`}>
                  {runs.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.created_at)} ({r.findings})</option>)}
                </select>
              </div>
              <button className={btn.primary}>Compare</button>
            </form>

            {project && can(user, "audit:start") && lastSettings && (
              <ActionForm action={startAuditAction} className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="startUrl" value={lastSettings.startUrl} />
                <input type="hidden" name="maxPages" value={lastSettings.maxPages ?? 20} />
                <input type="hidden" name="delayMs" value={lastSettings.delayMs ?? 1000} />
                <input type="hidden" name="urls" value={(lastSettings.urls ?? []).join("\n")} />
                {lastSettings.useSitemap !== false && <input type="hidden" name="useSitemap" value="on" />}
                {(lastSettings.viewports ?? []).map((v) => <input key={v} type="hidden" name="viewports" value={v} />)}
                {(lastSettings.categories ?? []).map((c) => <input key={c} type="hidden" name="categories" value={c} />)}
                <Submit>Run fresh audit with the same settings</Submit>
                <span className="text-xs text-slate-500">Read-only. Uses the settings of the audit from {fmtDate(latest!.created_at)}.</span>
              </ActionForm>
            )}
          </Card>

          {runs.length < 2 && <Empty title="Two completed audits are needed to compare">Run a fresh audit after fixes are deployed.</Empty>}
          {compareError && <Notice tone="error">{compareError}</Notice>}

          {comparison && (
            <>
              <div className="mb-4 flex flex-wrap gap-2" data-testid="compare-counts">
                <Link href={`/reaudit?base=${base!.id}&latest=${latest!.id}`} className={cx(btn.secondary, !sp.status && "border-navy-900")}>All ({comparison.rows.length})</Link>
                {ORDER.map((s) => (
                  <Link key={s} href={`/reaudit?base=${base!.id}&latest=${latest!.id}&status=${s}`} className={cx(btn.secondary, sp.status === s && "border-navy-900")} data-status={s}>
                    {STATUS_LABEL[s]} ({comparison!.counts[s] ?? 0})
                  </Link>
                ))}
              </div>
              <p className="mb-4 text-xs text-slate-500">
                Matched by finding fingerprint (rule + element). “Resolved” requires every affected page to have been scanned successfully in the newer audit; otherwise the finding is “Unable to verify”. False positives are excluded.
              </p>
              {rows.length === 0 ? <Empty title="Nothing in this group" /> : (
                <div className="space-y-3">
                  {rows.map((r, n) => {
                    const target = r.latestIssue ?? r.baseIssue!;
                    const before = n < MAX_IMAGE_ROWS ? shot(r.baseIssue?.id) : undefined;
                    const after = n < MAX_IMAGE_ROWS ? shot(r.latestIssue?.id) : undefined;
                    return (
                      <div key={r.fingerprint} className="rounded-lg border border-slate-200 bg-white p-3" data-testid="compare-row" data-status={r.status}>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={r.status} /><SeverityBadge severity={r.severity} />
                          <Link href={`/issues/${target.id}`} className="font-medium text-navy-900 hover:underline">{target.code}: {r.title}</Link>
                          <span className="text-xs text-slate-500">{shortUrl(r.pages[0] ?? "")}{r.pages.length > 1 ? ` +${r.pages.length - 1}` : ""}</span>
                        </div>
                        {(r.before || r.after) && (
                          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                            <div><span className="text-xs uppercase text-slate-500">Before</span><div className="font-mono text-xs">{r.before ?? "–"}</div></div>
                            <div><span className="text-xs uppercase text-slate-500">After</span><div className="font-mono text-xs">{r.after ?? (r.status === "resolved" ? "Not found in the newer audit" : "–")}</div></div>
                          </div>
                        )}
                        {(before || after) && (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {before ? <img src={before} alt="Before" className="max-h-56 w-full rounded border border-slate-200 object-contain" loading="lazy" /> : <div />}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {after ? <img src={after} alt="After" className="max-h-56 w-full rounded border border-slate-200 object-contain" loading="lazy" /> : <div />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
