import Link from "next/link";
import { orNotFound, requireUser } from "@/app/lib/session";
import { getIssue } from "@/server/issues";
import { projectMembers } from "@/server/projects";
import { can } from "@/server/permissions";
import { aiSettings } from "@/server/settings";
import { evidenceUrl } from "@/server/files";
import { reviewAction, explainIssueAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { EvidenceViewer, type Shot } from "@/components/EvidenceViewer";
import { AiExplain } from "@/components/AiExplain";
import { Card, cx, fmtDate, input, KindBadge, label, Notice, PageHeader, SeverityBadge, shortUrl, STATUS_LABEL, StatusPill } from "@/components/ui";
import { TYPE_LABEL } from "@/components/constants";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  confirm: "Confirmed finding", false_positive: "Marked false positive", unverify: "Reset verification", approve: "Approved recommendation",
  request_revision: "Requested revision", reject: "Rejected recommendation", assign: "Assigned", priority: "Set priority", note: "Added note",
  implementation: "Implementation status", client_approved: "Client approved", client_rejected: "Client rejected", client_revision_requested: "Client requested revision",
};

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const i = orNotFound(() => getIssue(user, id));
  const members = projectMembers(user, i.project_id);
  const reviewer = can(user, "issue:review");
  const implementer = can(user, "issue:implement") && (user.role !== "developer" || !i.assignee_id || i.assignee_id === user.id);
  const ai = aiSettings();

  const shots: Shot[] = i.evidence.screenshots.map((s) => ({
    viewport: s.viewport,
    src: evidenceUrl(i.run_id, s.path),
    boxes: i.occurrences.filter((o) => o.url === i.url && o.viewport === s.viewport).flatMap((o) => o.boxes as Shot["boxes"]).slice(0, 20),
  }));
  const css = Object.entries(i.evidence.computedCss ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "");

  return (
    <>
      <div className="mb-2 text-sm"><Link href={`/issues?run=${i.run_id}`} className="text-accent-600 hover:underline">← All findings in this audit</Link></div>
      <PageHeader
        title={`${i.code}: ${i.title}`}
        subtitle={<>{i.project_name} · {TYPE_LABEL[i.type] ?? i.type} · rule <code className="text-xs">{i.rule}</code> · captured {fmtDate(i.captured_at)}</>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={i.severity} /><KindBadge kind={i.kind} />
        <span className="text-xs text-slate-600">Confidence {Math.round(i.confidence * 100)}%</span>
        <span className="text-xs text-slate-500">Verification</span><StatusPill status={i.verification_status} />
        <span className="text-xs text-slate-500">Review</span><StatusPill status={i.review_status} />
        <span className="text-xs text-slate-500">Implementation</span><StatusPill status={i.implementation_status} />
        {i.priority && <span className="text-xs text-slate-600">Priority: <strong className="capitalize">{i.priority}</strong></span>}
        {i.client_decision && <span className="text-xs text-slate-600">Client: <strong>{STATUS_LABEL[i.client_decision] ?? i.client_decision}</strong></span>}
      </div>

      {i.shared_template ? (
        <div className="mb-4"><Notice tone="warn">
          Shared template or component: this appears on {i.pages.length} page{i.pages.length === 1 ? "" : "s"}{i.instance_count > 1 ? ` (${i.instance_count} instances)` : ""}. Changing it in the global template or widget affects all of them.
        </Notice></div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card title="Current vs Proposed">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-sev-high/30 bg-sev-high-bg/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-sev-high">Current (measured)</div>
                <div className="mt-1 break-words font-mono text-sm" data-testid="current-value">{i.current_value ?? "Not measured"}</div>
              </div>
              <div className="rounded-md border border-ok/30 bg-ok-bg/60 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-ok">Proposed</div>
                <div className="mt-1 break-words font-mono text-sm" data-testid="proposed-value">
                  {i.proposed_value ?? <span className="font-sans italic text-slate-600">Human review required: no reliable measured correction is available.</span>}
                </div>
              </div>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-navy-900">Recommendation</h3>
            <p className="mt-1 text-sm text-slate-700">{i.recommendation}</p>
            <h3 className="mt-4 text-sm font-semibold text-navy-900">Evidence</h3>
            <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Page</dt><dd className="break-all"><a href={i.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 underline">{i.url}</a></dd>
              <dt className="text-slate-500">Viewports</dt><dd>{i.viewports.map((v) => `${v}px`).join(", ")}</dd>
              <dt className="text-slate-500">Selector</dt><dd className="break-all font-mono text-xs">{i.selector ?? "Page level"}</dd>
              {i.elementor_id && <><dt className="text-slate-500">Elementor widget</dt><dd className="font-mono text-xs">{i.elementor_id}</dd></>}
              <dt className="text-slate-500">Classification</dt>
              <dd>{i.kind === "confirmed" ? "Measured and objectively verifiable." : i.kind === "recommendation" ? "Design improvement based on approved tokens or the site's own pattern." : "Uncertain: needs human judgement before any client claim."}</dd>
            </dl>
            {css.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-semibold text-navy-900">Computed CSS</h3>
                <table className="mt-1 text-xs">
                  <tbody>{css.map(([k, v]) => <tr key={k}><td className="pr-4 font-mono text-slate-500">{k}</td><td className="font-mono">{String(v)}</td></tr>)}</tbody>
                </table>
              </>
            )}
          </Card>

          <Card title="Screenshot evidence">
            <EvidenceViewer shots={shots} annotated={i.evidence.annotated ? evidenceUrl(i.run_id, i.evidence.annotated) : undefined} pageUrl={i.url} />
          </Card>

          {i.pages.length > 1 && (
            <Card title={`Affected pages (${i.pages.length})`}>
              <ul className="max-h-60 space-y-1 overflow-auto text-sm">
                {i.pages.map((p) => <li key={p} className="truncate"><a href={p} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">{shortUrl(p)}</a></li>)}
              </ul>
            </Card>
          )}

          {ai.enabled && ai.hasKey && (
            <Card title="AI explanation (optional)">
              <AiExplain issueId={i.id} action={explainIssueAction} />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {reviewer && (
            <Card title="Internal review">
              <ActionForm action={reviewAction} className="space-y-3">
                <input type="hidden" name="issueId" value={i.id} />
                <label htmlFor="note" className={label}>Note (optional, saved with the decision)</label>
                <textarea id="note" name="note" rows={2} className={input} />
                <div className="grid grid-cols-2 gap-2">
                  <Submit name="action" value="confirm" variant="secondary">Confirm finding</Submit>
                  <Submit name="action" value="false_positive" variant="secondary">Mark false positive</Submit>
                  <Submit name="action" value="approve" variant="secondary">Approve recommendation</Submit>
                  <Submit name="action" value="request_revision" variant="secondary">Request revision</Submit>
                  <Submit name="action" value="reject" variant="danger">Reject recommendation</Submit>
                  <Submit name="action" value="note" variant="secondary">Add note only</Submit>
                </div>
              </ActionForm>
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <ActionForm action={reviewAction} className="space-y-2">
                  <input type="hidden" name="issueId" value={i.id} /><input type="hidden" name="action" value="assign" />
                  <label htmlFor="assigneeId" className={label}>Assign developer</label>
                  <select id="assigneeId" name="assigneeId" defaultValue={i.assignee_id ?? ""} className={input}>
                    <option value="">Unassigned</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <Submit variant="secondary">Save assignee</Submit>
                </ActionForm>
                <ActionForm action={reviewAction} className="space-y-2">
                  <input type="hidden" name="issueId" value={i.id} /><input type="hidden" name="action" value="priority" />
                  <label htmlFor="priority" className={label}>Priority</label>
                  <select id="priority" name="priority" defaultValue={i.priority ?? ""} className={input}>
                    <option value="">Not set</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                  <Submit variant="secondary">Save priority</Submit>
                </ActionForm>
              </div>
            </Card>
          )}

          {implementer && (
            <Card title="Implementation">
              <ActionForm action={reviewAction} className="space-y-2">
                <input type="hidden" name="issueId" value={i.id} /><input type="hidden" name="action" value="implementation" />
                <label htmlFor="status" className={label}>Status</label>
                <select id="status" name="status" defaultValue={i.implementation_status} className={input}>
                  <option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="wont_fix">Won&apos;t fix</option>
                </select>
                <label htmlFor="impl-note" className={label}>Note</label>
                <textarea id="impl-note" name="note" rows={2} className={input} />
                <Submit variant="secondary">Save</Submit>
              </ActionForm>
              <p className="mt-2 text-xs text-slate-500">Recording status here never changes the website. Fixes happen in a separate, authorized workflow.</p>
            </Card>
          )}

          {i.notes && (
            <Card title="Reviewer notes"><pre className="whitespace-pre-wrap font-sans text-sm text-slate-700" data-testid="notes">{i.notes}</pre></Card>
          )}

          {i.decisions.length > 0 && (
            <Card title="Client decisions">
              <ul className="space-y-2 text-sm">
                {i.decisions.map((d, n) => (
                  <li key={n}>
                    <StatusPill status={d.decision} /> <span className="font-medium">{d.client_name}</span> <span className="text-xs text-slate-500">{d.client_email} · {fmtDate(d.created_at)} · {d.package_title}</span>
                    {d.comment && <p className="mt-1 text-slate-700">“{d.comment}”</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Review history">
            {i.events.length ? (
              <ol className="space-y-2 text-sm" data-testid="history">
                {i.events.map((e) => (
                  <li key={e.id} className={cx("border-l-2 pl-3", e.actor_label.startsWith("Client:") ? "border-accent-500" : "border-slate-200")}>
                    <div><span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
                      {e.to_value && e.action !== "note" && <> → {STATUS_LABEL[e.to_value] ?? e.to_value}</>}</div>
                    <div className="text-xs text-slate-500">{e.actor_label} · {fmtDate(e.created_at)}</div>
                    {e.note && <p className="mt-0.5 text-slate-700">{e.note}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-slate-500">No review decisions yet.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
