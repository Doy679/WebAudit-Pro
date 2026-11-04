"use client";

// Monitoring targets on /google/pagespeed: choose which pages are measured, save the choice, and start a run only
// after a confirmation that restates the numbers. Changing or saving the selection never sends a request.
import { useMemo, useRef, useState } from "react";
import type { ActionState } from "@/app/actions";
import { ActionForm, Submit } from "./forms";
import { btn, cx, input } from "./ui";
import { batchSize as sizeFor, chunk, exclusionReason, isSelectable, LICENSING_LABEL, summary } from "@/server/google/target-rules";

export interface TargetView {
  id: string; label: string; url: string | null; group: string; state_code: string | null;
  licensing_status: "eligible" | "license_pending" | "not_licensed"; verification_status: string; verification_note: string | null; selected: boolean;
}

type Action = (s: ActionState, fd: FormData) => Promise<ActionState>;

const BADGE: Record<string, string> = {
  eligible: "bg-ok-bg text-ok", license_pending: "bg-sev-med-bg text-sev-med", not_licensed: "bg-slate-200 text-slate-700", review: "bg-sev-high-bg text-sev-high",
};

function Badge({ t }: { t: TargetView }) {
  const review = t.url && t.verification_status === "needs_url_review";
  const key = review ? "review" : t.licensing_status;
  return <span className={cx("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold", BADGE[key])}>{review ? "Needs URL Review" : LICENSING_LABEL[t.licensing_status]}</span>;
}

export function PageSpeedTargets({ projectId, targets, projectLimit, cachedKeys, inFlightKeys, canEdit, canRun, blocked, inProgress, saveAction, runAction }: {
  projectId: string; targets: TargetView[]; projectLimit: number; cachedKeys: string[]; inFlightKeys: string[];
  canEdit: boolean; canRun: boolean; blocked: string | null; inProgress: boolean; saveAction: Action; runAction: Action;
}) {
  const saved = useMemo(() => new Set(targets.filter((t) => t.selected).map((t) => t.id)), [targets]);
  const [sel, setSel] = useState<Set<string>>(() => new Set(saved));
  const [query, setQuery] = useState("");
  const [mobile, setMobile] = useState(true);
  const [desktop, setDesktop] = useState(true);
  const [skipCache, setSkipCache] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const dirty = sel.size !== saved.size || [...sel].some((id) => !saved.has(id));
  const home = targets.filter((t) => t.group === "homepage");
  const states = targets.filter((t) => t.group !== "homepage");
  const shown = states.filter((t) => !query.trim() || `${t.label} ${t.state_code ?? ""} ${t.url ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const chosen = targets.filter((t) => sel.has(t.id) && isSelectable(t));
  const urls = chosen.map((t) => t.url!);
  const size = sizeFor(projectLimit);
  const devices = [mobile && "mobile", desktop && "desktop"].filter(Boolean) as string[];
  const total = urls.length * devices.length;
  const cached = new Set(cachedKeys), inFlight = new Set(inFlightKeys);
  let queued = 0, hits = 0;
  for (const u of urls) for (const d of devices) { if (inFlight.has(`${u}|${d}`)) queued++; else if (!skipCache && cached.has(`${u}|${d}`)) hits++; }
  const batches = chunk(urls, size);
  const line = summary(urls.length, { mobile, desktop }, size);

  const toggle = (id: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const runDisabled = !canRun || !!blocked || inProgress || dirty || total === 0;
  const runWhy = !canRun ? "You don't have permission to start PageSpeed runs." : blocked ? blocked : inProgress ? "A run for this website is in progress." : dirty ? "Save the target selection first." : total === 0 ? "Select at least one page and one device." : null;

  const item = (t: TargetView) => {
    const ok = isSelectable(t);
    const reason = exclusionReason(t);
    return (
      <li key={t.id} className="flex items-start gap-2 rounded border border-slate-200 bg-white p-2" data-testid="target-item" data-state={t.licensing_status} data-selected={sel.has(t.id) ? "1" : "0"}>
        <input type="checkbox" id={`t-${t.id}`} className="mt-1 h-4 w-4 shrink-0" checked={sel.has(t.id) && ok} disabled={!ok || !canEdit} onChange={(e) => toggle(t.id, e.target.checked)} />
        <label htmlFor={`t-${t.id}`} className="min-w-0 flex-1 text-sm">
          <span className="flex flex-wrap items-center gap-1.5"><span className="font-medium text-navy-900">{t.label}</span><Badge t={t} /></span>
          <span className="block break-all text-xs text-slate-500">{t.url ?? "No landing page"}</span>
          {reason && <span className="block text-xs text-slate-600">{reason}</span>}
        </label>
      </li>
    );
  };

  return (
    <div data-testid="pagespeed-targets">
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur" data-testid="targets-summary">
        <p className="text-sm font-medium text-navy-900" data-testid="targets-summary-line">{line}</p>
        {dirty && <p className="text-xs font-medium text-sev-med" data-testid="targets-unsaved">Unsaved changes: save the selection before running.</p>}
      </div>

      <ActionForm action={saveAction} className="space-y-4">
        <input type="hidden" name="projectId" value={projectId} />
        {[...sel].map((id) => <input key={id} type="hidden" name="target" value={id} />)}

        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-slate-700">Homepage</legend>
          <ul className="grid gap-2">{home.map(item)}</ul>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-slate-700">State landing pages ({states.filter((t) => sel.has(t.id) && isSelectable(t)).length} of {states.filter(isSelectable).length} eligible selected)</legend>
          <label htmlFor="target-search" className="sr-only">Search states</label>
          <input id="target-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search states or URLs" className={`${input} mb-2`} />
          <ul className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3" data-testid="target-list">
            {shown.map(item)}
          </ul>
          {!shown.length && <p className="text-sm text-slate-500">No state matches “{query}”.</p>}
        </fieldset>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.secondary} onClick={() => setSel(new Set([...home, ...states].filter(isSelectable).map((t) => t.id)))}>Select all eligible states</button>
            <button type="button" className={btn.secondary} onClick={() => setSel(new Set())}>Clear selection</button>
            <Submit variant="secondary" disabled={!dirty}>Save target selection</Submit>
          </div>
        )}
      </ActionForm>

      <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1"><input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} /> Mobile</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={desktop} onChange={(e) => setDesktop(e.target.checked)} /> Desktop</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={skipCache} onChange={(e) => setSkipCache(e.target.checked)} /> Skip the 6-hour cache</label>
        </div>
        <details className="text-sm" data-testid="review-selected">
          <summary className="cursor-pointer font-medium text-accent-600">Review selected URLs ({urls.length}) in {batches.length} batch{batches.length === 1 ? "" : "es"} of up to {size}</summary>
          <ol className="mt-2 space-y-2">
            {batches.map((b, i) => (
              <li key={i}><span className="text-xs font-semibold text-slate-600">Batch {i + 1} ({b.length} URLs, {b.length * devices.length} requests)</span>
                <ul className="ml-4 list-disc text-xs text-slate-700">{b.map((u) => <li key={u} className="break-all">{u}</li>)}</ul></li>
            ))}
          </ol>
        </details>
        <div>
          <button type="button" className={btn.primary} disabled={runDisabled} onClick={() => dialog.current?.showModal()} data-testid="run-targets">Run selected PageSpeed checks</button>
          {runWhy && <p className="mt-1 text-xs text-slate-600" data-testid="run-blocked">{runWhy}</p>}
        </div>
      </div>

      <dialog ref={dialog} className="w-[min(32rem,calc(100vw-2rem))] rounded-lg p-0 shadow-xl backdrop:bg-slate-900/40" aria-labelledby="run-dialog-title" data-testid="run-dialog">
        <ActionForm action={runAction} className="space-y-3 p-5">
          <h2 id="run-dialog-title" className="text-base font-semibold text-navy-900">Run PageSpeed checks?</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt>Selected URLs</dt><dd className="tabular font-medium">{urls.length}</dd>
            <dt>Devices</dt><dd className="font-medium">{devices.map((d) => d[0].toUpperCase() + d.slice(1)).join(" + ") || "none"}</dd>
            <dt>Batches (up to {size} URLs each)</dt><dd className="tabular font-medium">{batches.length}</dd>
            <dt>Total requests</dt><dd className="tabular font-medium">{total}</dd>
            <dt>Likely reused from the 6-hour cache</dt><dd className="tabular font-medium">{hits}</dd>
            {queued > 0 && <><dt>Already queued</dt><dd className="tabular font-medium">{queued}</dd></>}
            <dt>Estimated new Google requests</dt><dd className="tabular font-semibold">{total - hits - queued}</dd>
          </dl>
          <p className="text-xs text-slate-600">Each new request uses PageSpeed API quota and takes about 10–40 seconds at Google. Earlier results are kept.</p>
          <input type="hidden" name="projectId" value={projectId} />
          {devices.map((d) => <input key={d} type="hidden" name="device" value={d} />)}
          <input type="hidden" name="skipCache" value={skipCache ? "1" : "0"} />
          <input type="hidden" name="expectedRequests" value={total} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" required className="mt-1" /> I confirm sending up to {total - hits - queued} requests to Google.</label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={() => dialog.current?.close()}>Cancel</button>
            <Submit>Start run</Submit>
          </div>
        </ActionForm>
      </dialog>
    </div>
  );
}
