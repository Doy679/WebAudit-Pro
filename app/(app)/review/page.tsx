import Link from "@/components/AppLink";
import { requireUser } from "@/app/lib/session";
import { reviewActionsFor, reviewQueue, statusWords, issueReference } from "@/server/issues";
import { parseIssueSearchParams } from "@/server/issue-filters";
import { explainIssue } from "@/server/explain";
import { evidenceUrl } from "@/server/files";
import { listRuns } from "@/server/runs";
import { listProjects } from "@/server/projects";
import { reviewQueueAction, undoReviewAction } from "@/app/actions";
import { EvidenceViewer, type Shot } from "@/components/EvidenceViewer";
import { ReviewShortcuts } from "@/components/ReviewShortcuts";
import { btn, Card, cx, Empty, fmtDate, input, Notice, PageHeader, SeverityBadge, shortUrl } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review queue" };

type SP = Record<string, string | undefined>;
const KEYS: Record<string, string> = { confirm: "a", approve: "a", false_positive: "f", reject: "r", request_revision: "v", note: "o" };
const DONE: Record<string, string> = {
  confirm: "Accepted", false_positive: "Marked as false positive", approve: "Approved", reject: "Rejected", request_revision: "Sent back for revision", note: "Note saved",
};

/** UX-03: review findings one at a time, highest priority first, without going back to the Issues list. */
export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("issue:review");
  const sp = await searchParams;
  const filters = parseIssueSearchParams(sp);
  const runs = listRuns(user, { status: "completed", limit: 50 });
  const runId = filters.runId ?? runs[0]?.id;
  const q = runId ? reviewQueue(user, { ...filters, runId }, Number(sp.pos) || 0) : null;
  const run = runs.find((r) => r.id === runId);
  // Filters travel with every action so the queue stays the same.
  const keep: Record<string, string | undefined> = { project: sp.project, run: runId, severity: sp.severity, quick: sp.quick, type: sp.type, types: sp.types, q: sp.q };
  const href = (patch: SP) => `/review?${new URLSearchParams(Object.entries({ ...keep, ...patch }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const hidden = (
    <>
      {Object.entries(keep).map(([k, v]) => v ? <input key={k} type="hidden" name={`f_${k}`} value={v} /> : null)}
      <input type="hidden" name="pos" value={q?.position ?? 0} />
    </>
  );

  return (
    <>
      <PageHeader title="Review queue" subtitle="One finding at a time, highest priority first. Accept real problems, dismiss false positives, then move on. Nothing is sent to the client from here." />
      <ReviewShortcuts />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3" aria-label="Choose what to review">
        <label className="block text-xs font-medium text-slate-600">Audit
          <select name="run" defaultValue={runId} className={cx(input, "mt-1 py-1.5")}>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.project_name}: {fmtDate(r.created_at)}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">Priority
          <select name="severity" defaultValue={sp.severity ?? ""} className={cx(input, "mt-1 py-1.5")}>
            <option value="">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </label>
        <button className={btn.secondary}>Show</button>
        {listProjects(user).length > 0 && <Link href="/issues" className="text-sm text-accent-600 underline">Back to the Issues list</Link>}
      </form>

      {sp.did && <div className="mb-3"><Notice tone="ok">
        {DONE[sp.did] ?? "Saved"}{Number(sp.n) > 1 ? ` (${sp.n} findings)` : ""}.{" "}
        {sp.last && sp.did !== "note" && (
          <form action={undoReviewAction} className="inline">
            {hidden}<input type="hidden" name="last" value={sp.last} /><input type="hidden" name="did" value={sp.did} />
            <button className="underline">Undo</button>
          </form>
        )}
      </Notice></div>}
      {sp.undone && <div className="mb-3"><Notice tone="info">Undone. The finding is back in the queue.</Notice></div>}

      {!run ? <Empty title="No completed audits yet" /> : !q ? (
        <Empty title="Nothing left to review here">
          Every finding matching these filters has been reviewed. <Link href={`/approvals?run=${runId}`} className="text-accent-600 underline">Release reviewed findings to the client</Link>
        </Empty>
      ) : (
        <>
          <div className="mb-3" data-testid="review-progress">
            <div className="flex flex-wrap justify-between gap-2 text-sm text-slate-700">
              <span><strong>{q.reviewed}</strong> of {q.total} reviewed · {q.remaining} left · {run.project_name}, audit of {fmtDate(run.created_at)}</span>
              <span>Finding {q.position + 1} of {q.remaining} still to review</span>
            </div>
            <div className="mt-1 h-2 rounded bg-slate-200" role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={q.total} aria-valuenow={q.reviewed}>
              <div className="h-2 rounded bg-ok" style={{ width: `${q.total ? (q.reviewed / q.total) * 100 : 0}%` }} />
            </div>
          </div>
          <QueueItem q={q} hidden={hidden} href={href} />
        </>
      )}
    </>
  );
}

function QueueItem({ q, hidden, href }: { q: NonNullable<ReturnType<typeof reviewQueue>>; hidden: React.ReactNode; href: (p: SP) => string }) {
  const i = q.item;
  const plain = explainIssue(i);
  const words = statusWords(i);
  const shots: Shot[] = i.evidence.screenshots.map((s) => ({
    viewport: s.viewport, src: evidenceUrl(i.run_id, s.path),
    boxes: i.occurrences.filter((o) => o.url === i.url && o.viewport === s.viewport).flatMap((o) => o.boxes as Shot["boxes"]).slice(0, 20),
  }));
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="queue-item" data-issue={i.id}>
      <Card title={<span>{issueReference(i.project_name, i.code)}: {i.title}</span>}>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <SeverityBadge severity={i.severity} /> <span>{words.detected}</span> · <span>{Math.round(i.confidence * 100)}% confidence</span> ·
          <a href={i.url} target="_blank" rel="noopener noreferrer" className="break-all text-accent-600 underline">{shortUrl(i.url)}</a>
        </div>
        <p className="text-sm text-slate-800"><strong>What&apos;s wrong: </strong>{plain.what}</p>
        <p className="mt-1 text-sm text-slate-800"><strong>Why it matters: </strong>{plain.why}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-sev-high/30 bg-sev-high-bg/50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-sev-high">Current</div>
            <div className="mt-1 break-words font-mono text-sm">{i.current_value ?? "Not measured"}</div>
          </div>
          <div className="rounded-md border border-ok/30 bg-ok-bg/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ok">Proposed (text recommendation)</div>
            <div className="mt-1 break-words font-mono text-sm">{i.proposed_value ?? "Human review required"}</div>
          </div>
        </div>
        {shots.length > 0 && <div className="mt-4"><EvidenceViewer shots={shots} annotated={i.evidence.annotated ? evidenceUrl(i.run_id, i.evidence.annotated) : undefined} pageUrl={i.url} cropViewport={(i.evidence as { annotatedViewport?: number }).annotatedViewport} /></div>}
        <p className="mt-3 text-sm"><Link href={`/issues/${i.id}`} className="text-accent-600 underline">Open full details (technical evidence, history)</Link></p>
      </Card>

      <Card title="Your decision">
        <form action={reviewQueueAction} className="space-y-3" data-testid="queue-form">
          {hidden}
          <input type="hidden" name="issueId" value={i.id} />
          <p className="text-xs text-slate-600">{i.kind === "recommendation" ? "A recommended improvement: approve it, send it back, or reject it." : "A measured or possible problem: accept it if it's real, or mark it as a false positive."}</p>
          <label htmlFor="q-note" className="block text-sm font-medium text-slate-700">Note (optional)</label>
          <textarea id="q-note" name="note" rows={2} className={input} />
          {q.similar.length > 0 && (
            <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
              <input type="checkbox" name="applySimilar" className="mt-1" />
              <span>Also apply to the <strong>{q.similar.length}</strong> other unreviewed finding{q.similar.length === 1 ? "" : "s"} in this audit with the same rule and the same measured value ({i.current_value ?? "no value"}).</span>
              {q.similar.map((s) => <input key={s} type="hidden" name="similar" value={s} />)}
            </label>
          )}
          <div className="grid grid-cols-2 gap-2" data-testid="queue-actions">
            {reviewActionsFor(i.kind).map((a) => (
              <button key={a.action} type="submit" name="action" value={a.action} data-key={KEYS[a.action]} className={a.variant === "danger" ? btn.danger : btn.secondary}>
                {a.action === "confirm" ? "Accept finding" : a.label} <kbd className="ml-1 rounded border border-slate-300 px-1 text-[10px] text-slate-500">{KEYS[a.action]?.toUpperCase()}</kbd>
              </button>
            ))}
          </div>
        </form>
        <nav aria-label="Move through the queue" className="mt-4 flex justify-between gap-2 border-t border-slate-100 pt-3 text-sm">
          {q.position > 0 ? <Link href={href({ pos: String(q.position - 1) })} className={btn.secondary} data-key="p">← Previous <kbd className="ml-1 text-[10px]">P</kbd></Link> : <span />}
          {q.position < q.remaining - 1 ? <Link href={href({ pos: String(q.position + 1) })} className={btn.secondary} data-key="n">Skip for now → <kbd className="ml-1 text-[10px]">N</kbd></Link> : <span />}
        </nav>
        <p className="mt-2 text-xs text-slate-500">Keyboard: A accept / approve · F false positive · R reject · V revision · O note only · N next · P previous. Decisions are saved at once and can be undone.</p>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs text-slate-600">
          <dt>Team review</dt><dd>{words.team}</dd><dt>Client</dt><dd>{words.client}</dd><dt>Fix</dt><dd>{words.fix}</dd>
        </dl>
      </Card>
    </div>
  );
}
