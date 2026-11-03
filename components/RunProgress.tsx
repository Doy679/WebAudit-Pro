"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cx, StatusPill } from "./ui";

export interface ProgressData {
  status: string;
  phase: string | null;
  error: string | null;
  cancelRequested: boolean;
  pagesTotal: number;
  pagesDone: number;
  pagesFailed: number;
  pagesSkipped: number;
  currentUrl: string | null;
  currentViewport: number | null;
  findingsRaw: number;
  findings: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
}

const PHASES: Record<string, string> = {
  starting: "Starting browser", discovering: "Discovering pages", scanning: "Scanning pages", "checking-links": "Checking internal links",
  analyzing: "Analyzing measurements", annotating: "Drawing screenshot evidence", writing: "Saving results", importing: "Saving findings",
};
const ACTIVE = new Set(["pending", "running"]);

function elapsed(from: string | null, to: string | null) {
  if (!from) return "–";
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Polls the saved run state. Nothing is held only in the browser, so refreshes and reconnects resume cleanly. */
export function RunProgress({ runId, initial }: { runId: string; initial: ProgressData }) {
  const [data, setData] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [, tick] = useState(0);
  const router = useRouter();
  const wasActive = useRef(ACTIVE.has(initial.status));

  useEffect(() => {
    if (!ACTIVE.has(data.status)) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as ProgressData;
        if (!stop) { setData(next); setOffline(false); }
      } catch {
        if (!stop) setOffline(true);
      }
    };
    const id = setInterval(poll, 1500);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => { stop = true; clearInterval(id); clearInterval(clock); };
  }, [runId, data.status]);

  useEffect(() => {
    if (wasActive.current && !ACTIVE.has(data.status)) {
      wasActive.current = false;
      router.refresh(); // load the completion summary
    }
  }, [data.status, router]);

  const pct = data.status === "completed" ? 100 : data.pagesTotal ? Math.min(99, Math.round((data.pagesDone / data.pagesTotal) * 100)) : 0;
  const stale = data.status === "running" && data.heartbeatAt && Date.now() - Date.parse(data.heartbeatAt) > 120_000;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="run-progress" data-status={data.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusPill status={data.status} />
          <span className="text-sm text-slate-700">
            {data.status === "pending" ? "Waiting for the audit worker…" : ACTIVE.has(data.status) ? PHASES[data.phase ?? ""] ?? data.phase : null}
            {data.cancelRequested && ACTIVE.has(data.status) && " · cancelling after the current page"}
          </span>
        </div>
        <span className="tabular text-sm text-slate-500">Elapsed {elapsed(data.startedAt ?? data.createdAt, data.finishedAt)}</span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Audit progress">
        <div className={cx("h-full rounded-full transition-all", data.status === "failed" ? "bg-sev-high" : "bg-accent-500")} style={{ width: `${pct}%` }} />
      </div>
      <div className="tabular mt-1 text-right text-xs text-slate-500">{pct}%</div>

      <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Pages discovered", data.pagesTotal],
          ["Pages completed", data.pagesDone],
          ["Pages failed", data.pagesFailed],
          ["Pages skipped", data.pagesSkipped],
          ["Raw findings", data.findingsRaw],
          ["Grouped findings", data.status === "completed" ? data.findings : "–"],
        ].map(([k, v]) => (
          <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="tabular font-semibold text-navy-900">{v}</dd></div>
        ))}
      </dl>

      {ACTIVE.has(data.status) && data.currentUrl && (
        <p className="mt-3 truncate text-sm text-slate-600" data-testid="current-url">
          Now: <span className="font-mono text-xs">{data.currentUrl}</span>{data.currentViewport ? ` @ ${data.currentViewport}px` : ""}
        </p>
      )}
      {data.error && <p className="mt-3 rounded bg-sev-high-bg px-3 py-2 text-sm text-sev-high">{data.error}</p>}
      {offline && <p className="mt-3 text-xs text-sev-med">Connection lost. Retrying; the audit keeps running on the server.</p>}
      {stale && <p className="mt-3 text-xs text-sev-med">No update from the worker for over 2 minutes. Check that the worker process is running.</p>}
    </div>
  );
}
