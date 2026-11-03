"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

export interface Shot {
  viewport: number;
  src: string;
  boxes: { x: number; y: number; w: number; h: number }[];
}

/**
 * Shows the saved full-page screenshot for the chosen viewport with the affected element(s) outlined,
 * scrolled to the first box. Boxes are page coordinates from the capture, so they line up exactly.
 */
export function EvidenceViewer({ shots, annotated, pageUrl }: { shots: Shot[]; annotated?: string; pageUrl: string }) {
  const [mode, setMode] = useState<"crop" | number>(annotated ? "crop" : shots[0]?.viewport ?? "crop");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const shot = typeof mode === "number" ? shots.find((s) => s.viewport === mode) : undefined;

  useEffect(() => { setNatural(null); setFailed(false); }, [mode]);

  useEffect(() => {
    if (!shot || !natural || !scroller.current) return;
    const first = shot.boxes[0];
    if (!first) return;
    const scale = scroller.current.clientWidth / natural.w;
    scroller.current.scrollTop = Math.max(0, first.y * scale - 80);
  }, [shot, natural]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1" role="tablist" aria-label="Screenshot view">
        {annotated && (
          <button type="button" role="tab" aria-selected={mode === "crop"} onClick={() => setMode("crop")}
            className={cx("rounded px-2 py-1 text-xs font-medium", mode === "crop" ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-700")}>
            Highlighted crop
          </button>
        )}
        {shots.map((s) => (
          <button key={s.viewport} type="button" role="tab" aria-selected={mode === s.viewport} onClick={() => setMode(s.viewport)}
            className={cx("rounded px-2 py-1 text-xs font-medium", mode === s.viewport ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-700")}>
            {s.viewport}px full page
          </button>
        ))}
        <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-accent-600 underline">Open audited page ↗</a>
      </div>

      {failed && <p className="rounded bg-sev-med-bg p-3 text-sm text-sev-med">The saved screenshot file could not be loaded.</p>}

      {mode === "crop" && annotated && !failed && (
        <a href={annotated} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={annotated} alt="Annotated screenshot with the affected element outlined in red" className="mx-auto block h-auto max-w-full rounded border border-slate-200" onError={() => setFailed(true)} data-testid="evidence-image" />
        </a>
      )}

      {shot && !failed && (
        <div ref={scroller} className="max-h-[70vh] overflow-auto rounded border border-slate-200 bg-slate-50">
          <div className="relative" style={{ width: "100%" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shot.src}
              alt={`Full-page screenshot at ${shot.viewport}px`}
              className="block w-full"
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
              data-testid="evidence-image"
            />
            {natural && shot.boxes.map((b, i) => (
              <div key={i} aria-hidden className="pointer-events-none absolute border-[3px] border-sev-high bg-sev-high/10"
                style={{
                  left: `${(b.x / natural.w) * 100}%`, top: `${(b.y / natural.h) * 100}%`,
                  width: `${(Math.min(b.w, natural.w - b.x) / natural.w) * 100}%`, height: `${(b.h / natural.h) * 100}%`,
                }} />
            ))}
          </div>
        </div>
      )}
      {shot && shot.boxes.length === 0 && <p className="mt-1 text-xs text-slate-500">Page-level finding: no single element to highlight at this width.</p>}
    </div>
  );
}
