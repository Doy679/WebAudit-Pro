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
export function EvidenceViewer({ shots, annotated: storedCrop, pageUrl, cropViewport }: { shots: Shot[]; annotated?: string; pageUrl: string; cropViewport?: number }) {
  // BUG-19: an element with no size and no position can't be outlined; crops stored before the fix show only a dot
  // in the corner, so they aren't offered. The full-page screenshot opens instead, with an explanation.
  const unpositioned = shots.some((s) => s.boxes.length > 0) && shots.every((s) => s.boxes.every((b) => b.w <= 0 && b.h <= 0 && b.x <= 0 && b.y <= 0));
  // Older crops always used the first width; if the element isn't displayed there, that crop shows only a dot.
  const isPlaced = (s: Shot) => s.boxes.some((b) => !(b.w <= 0 && b.h <= 0 && b.x <= 0 && b.y <= 0));
  const hiddenAt = shots.filter((s) => s.boxes.length > 0 && !isPlaced(s)).map((s) => s.viewport);
  const firstPlaced = shots.find(isPlaced);
  const misleadingCrop = !cropViewport && shots[0] && !isPlaced(shots[0]) && !!firstPlaced;
  const annotated = unpositioned || misleadingCrop ? undefined : storedCrop;
  const [mode, setMode] = useState<"crop" | number>(annotated ? "crop" : firstPlaced?.viewport ?? shots[0]?.viewport ?? "crop");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const shot = typeof mode === "number" ? shots.find((s) => s.viewport === mode) : undefined;

  useEffect(() => { setNatural(null); setFailed(false); setZoom(false); }, [mode]);

  useEffect(() => {
    if (!shot || !natural || !scroller.current) return;
    const first = shot.boxes[0];
    if (!first) return;
    const scale = zoom ? 1 : scroller.current.clientWidth / natural.w;
    scroller.current.scrollTop = Math.max(0, first.y * scale - 80);
    if (zoom) scroller.current.scrollLeft = Math.max(0, first.x - 40);
  }, [shot, natural, zoom]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Screenshot view">
        {annotated && (
          <button type="button" aria-pressed={mode === "crop"} onClick={() => setMode("crop")}
            className={cx("rounded px-2.5 py-1.5 text-xs font-medium", mode === "crop" ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-700")}>
            Highlighted crop
          </button>
        )}
        {shots.map((s) => (
          <button key={s.viewport} type="button" aria-pressed={mode === s.viewport} onClick={() => setMode(s.viewport)}
            className={cx("rounded px-2.5 py-1.5 text-xs font-medium", mode === s.viewport ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-700")}>
            {s.viewport}px full page
          </button>
        ))}
      </div>
        {shot && natural && natural.w > 0 && (
          <button type="button" aria-pressed={zoom} onClick={() => setZoom(!zoom)} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50">
            {zoom ? "Fit to width" : "Zoom to actual size"}
          </button>
        )}
        <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-accent-600 underline">Open audited page ↗</a>
      </div>

      {failed && <p className="rounded bg-sev-med-bg p-3 text-sm text-sev-med">The saved screenshot file could not be loaded.</p>}

      {mode === "crop" && annotated && !failed && (
        <a href={annotated} target="_blank" rel="noopener noreferrer" title="Open the image at full size in a new tab">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={annotated} alt="Annotated screenshot with the affected element outlined in red" className="mx-auto block h-auto max-w-full rounded border border-slate-200" onError={() => setFailed(true)} data-testid="evidence-image" />
        </a>
      )}

      {shot && !failed && (
        <div ref={scroller} className="max-h-[70vh] overflow-auto rounded border border-slate-200 bg-slate-50" tabIndex={0} aria-label={`Scrollable screenshot at ${shot.viewport}px`}>
          <div className="relative" style={{ width: zoom && natural ? natural.w : "100%" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shot.src}
              alt={`Full-page screenshot at ${shot.viewport}px`}
              className="block w-full"
              loading="lazy"
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
      {mode === "crop" && annotated && <p className="mt-1 text-xs text-slate-500">Click the image to open it at full size.{cropViewport ? ` Taken from the ${cropViewport}px screenshot.` : ""}</p>}
      {!unpositioned && hiddenAt.length > 0 && (
        <p className="mt-1 text-xs text-slate-600" data-testid="hidden-at-note">This element isn&apos;t displayed at {hiddenAt.join(", ")}px (no size or position there), so it&apos;s outlined on the wider screenshots only.</p>
      )}
      {(unpositioned || (shot && shot.boxes.length > 0 && shot.boxes.every((b) => b.w <= 0 && b.h <= 0))) && (
        <p className="mt-1 text-xs text-slate-600" data-testid="no-size-note">This element has no visible size or position on the page (for example, an image that failed to load and isn&apos;t displayed), so it can&apos;t be outlined.</p>
      )}
      {shot && shot.boxes.length === 0 && <p className="mt-1 text-xs text-slate-500">Page-level finding: no single element to highlight at this width.</p>}
    </div>
  );
}
