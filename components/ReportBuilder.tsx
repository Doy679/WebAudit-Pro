"use client";

import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * BUG-15 / UX-06: the report preview refreshes by itself when an option changes, and the Generate buttons are
 * disabled while the preview is out of date or loading, so a report can't be generated from options the preview
 * doesn't show. The server still recalculates and rejects empty reports.
 */
const Stale = createContext<{ stale: boolean; markStale: () => void; refreshing: boolean; refresh: (q: string) => void }>({
  stale: false, markStale: () => {}, refreshing: false, refresh: () => {},
});

export function ReportBuilder({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [stale, setStale] = useState(false);
  const [refreshing, start] = useTransition();
  const refresh = (q: string) => start(() => { router.replace(`/reports?${q}`, { scroll: false }); setStale(false); });
  return <Stale.Provider value={{ stale: stale || refreshing, markStale: () => setStale(true), refreshing, refresh }}>{children}</Stale.Provider>;
}

/** The report options form: any change refreshes the preview after a short pause. */
export function OptionsForm({ children, className }: { children: ReactNode; className?: string }) {
  const { markStale, refresh } = useContext(Stale);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <form method="get" className={className} aria-label="Report options"
      onChange={(e) => {
        markStale();
        const form = e.currentTarget;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const q = new URLSearchParams();
          for (const [k, v] of new FormData(form)) if (String(v)) q.append(k, String(v));
          refresh(q.toString());
        }, 400);
      }}>
      {children}
    </form>
  );
}

/** Wraps the Generate buttons: disabled while the preview is stale or loading. */
export function GenerateGuard({ children }: { children: ReactNode }) {
  const { stale, refreshing } = useContext(Stale);
  return (
    <fieldset disabled={stale} aria-busy={refreshing} data-testid="generate-guard" data-stale={stale ? "1" : "0"}>
      {stale && <p role="status" className="mb-2 text-sm font-medium text-accent-600">Updating the preview for your new options… Generate is available again in a moment.</p>}
      {children}
    </fieldset>
  );
}
