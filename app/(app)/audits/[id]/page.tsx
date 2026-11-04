import Link from "@/components/AppLink";
import type { Metadata } from "next";
import { orNotFound, requireUser } from "@/app/lib/session";
import { cancellationNote, getRun, listRuns, queuePosition, runPages } from "@/server/runs";
import { workerStatus } from "@/server/worker-status";
import { getProject } from "@/server/projects";
import { runScoreInputs } from "@/server/issues";
import { qualityScore } from "@/server/score";
import { all } from "@/server/db";
import { can } from "@/server/permissions";
import { cancelAuditAction } from "@/app/actions";
import { RunProgress } from "@/components/RunProgress";
import { btn, Card, fmtDate, PageHeader, StatusPill } from "@/components/ui";
import { TYPE_LABEL } from "@/components/constants";
import { websiteHealth } from "@/server/health";
import { WebsiteHealth } from "@/components/WebsiteHealth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const r = getRun(await requireUser(), (await params).id);
    return { title: `Audit ${new Date(r.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · ${r.project_name}` };
  } catch {
    return { title: "Not found" };
  }
}

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const r = orNotFound(() => getRun(user, id));
  const project = getProject(user, r.project_id);
  const active = r.status === "pending" || r.status === "running";
  const pages = runPages(id);
  const previous = listRuns(user, { projectId: r.project_id, status: "completed" }).find((x) => x.created_at < r.created_at);

  const counts = (col: string) => Object.fromEntries(
    all<{ k: string; n: number }>(`SELECT ${col} AS k, COUNT(*) AS n FROM issues WHERE run_id = ? AND verification_status != 'false_positive' GROUP BY ${col}`, id).map((x) => [x.k, x.n]));
  const byKind = counts("kind"), bySeverity = counts("severity"), byType = counts("type");
  const scoreRows = r.status === "completed" ? runScoreInputs(user, id) : [];
  const score = r.status === "completed" ? qualityScore(scoreRows, pages.filter((p) => p.ok).length, pages.length) : null;

  return (
    <>
      <PageHeader
        title={`Audit: ${project.name}`}
        subtitle={<>{r.start_url} · queued {fmtDate(r.created_at)} · {r.started_at ? <>started {fmtDate(r.started_at)}</> : r.status === "pending" ? "not started yet" : "never started"}{r.finished_at ? <> · {r.status === "cancelled" ? "cancelled" : "finished"} {fmtDate(r.finished_at)}</> : null} · {r.settings.viewports?.join(", ")}px · max {r.settings.maxPages} pages</>}
        actions={
          <>
            {active && can(user, "audit:cancel") && !r.cancel_requested && (
              <form action={cancelAuditAction}>
                <input type="hidden" name="runId" value={id} />
                <button className={btn.danger} data-testid="cancel-audit">Cancel audit</button>
              </form>
            )}
            {r.status === "completed" && <Link href={`/issues?run=${id}`} className={btn.primary}>Review findings</Link>}
            {r.status === "completed" && <Link href={`/reports?run=${id}`} className={btn.secondary}>Reports</Link>}
            {r.status === "completed" && previous && <Link href={`/reaudit?base=${previous.id}&latest=${id}`} className={btn.secondary}>Compare with previous</Link>}
          </>
        }
      />

      <RunProgress
        runId={id}
        initial={{
          status: r.status, phase: r.phase, error: cancellationNote(r) ?? r.error, cancelRequested: !!r.cancel_requested,
          pagesTotal: r.pages_total, pagesDone: r.pages_done, pagesFailed: r.pages_failed, pagesSkipped: r.pages_skipped,
          currentUrl: r.current_url, currentViewport: r.current_viewport, findingsRaw: r.findings_raw, findings: r.findings,
          createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, heartbeatAt: r.heartbeat_at,
          projectName: project.name, queuePosition: r.status === "pending" ? queuePosition(r.id) : null,
          worker: (() => { const w = workerStatus(); return { state: w.state, label: w.label, detail: w.detail, currentRun: w.currentRun }; })(),
        }}
      />

      {r.status === "completed" && <div className="mt-6"><WebsiteHealth {...websiteHealth(user, r.project_id, id)} /></div>}

      {r.status === "completed" && (
        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <Card title="Completion summary">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">Confirmed</dt><dd className="tabular text-lg font-semibold">{byKind.confirmed ?? 0}</dd></div>
              <div><dt className="text-slate-500">Recommendations</dt><dd className="tabular text-lg font-semibold">{byKind.recommendation ?? 0}</dd></div>
              <div><dt className="text-slate-500">Needs review</dt><dd className="tabular text-lg font-semibold">{byKind["needs-review"] ?? 0}</dd></div>
              <div><dt className="text-slate-500">High severity</dt><dd className="tabular text-lg font-semibold text-sev-high">{bySeverity.high ?? 0}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">{r.findings_raw} raw single-viewport findings grouped into {r.findings} findings.</p>
          </Card>
          {score && (
            <Card title="Audit quality score">
              <div className="tabular text-4xl font-semibold text-navy-900" data-testid="quality-score">{score.score}<span className="text-lg text-slate-400">/100</span></div>
              <p className="mt-2 text-xs text-slate-500">{score.explanation}</p>
              <p className="mt-1 text-xs text-slate-500">Coverage {Math.round(score.coverage * 100)}% · deductions {score.deductions}</p>
            </Card>
          )}
          <Card title="By category">
            <ul className="space-y-1 text-sm">
              {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <li key={k} className="flex justify-between"><Link className="text-accent-600 hover:underline" href={`/issues?run=${id}&type=${k}`}>{TYPE_LABEL[k] ?? k}</Link><span className="tabular">{n}</span></li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {pages.length > 0 && (
        <Card title={`Pages (${pages.length})`} className="mt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-4">URL</th><th className="py-2 pr-4">HTTP</th><th className="py-2">Result</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {pages.map((p) => (
                  <tr key={p.url}>
                    <td className="max-w-md truncate py-2 pr-4"><Link href={`/issues?run=${id}&url=${encodeURIComponent(p.url)}`} className="text-navy-800 hover:underline">{p.url}</Link></td>
                    <td className="tabular py-2 pr-4">{p.status || "–"}</td>
                    <td className="py-2">{p.ok ? <StatusPill status="completed" label="Scanned" /> : <span className="text-xs text-sev-high">{p.error ?? "Failed"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
