import Link from "next/link";
import type { ReactNode } from "react";
import { cx, input, label } from "./ui";
import type { GscStatus } from "@/server/google/gsc-status";

/** PageSpeed's own colour bands: 90–100 good, 50–89 needs improvement, 0–49 poor. */
export function Score({ value, label: text }: { value: number | null | undefined; label?: string }) {
  if (value === null || value === undefined) return <Unavailable />;
  const tone = value >= 90 ? "bg-ok-bg text-ok ring-ok/30" : value >= 50 ? "bg-sev-med-bg text-sev-med ring-sev-med/30" : "bg-sev-high-bg text-sev-high ring-sev-high/30";
  return (
    <span className={cx("inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ring-2 tabular", tone)} title={text ? `${text}: ${value}/100` : `${value}/100`}>
      {value}
    </span>
  );
}

export function CwvBadge({ category }: { category: string | null | undefined }) {
  if (!category) return <Unavailable />;
  const tone = category === "good" ? "bg-ok-bg text-ok" : category === "poor" ? "bg-sev-high-bg text-sev-high" : "bg-sev-med-bg text-sev-med";
  return <span className={cx("rounded px-1.5 py-0.5 text-xs font-semibold", tone)}>{category.replace("-", " ")}</span>;
}

export function Unavailable({ why }: { why?: string }) {
  return <span className="text-xs italic text-slate-500" title={why}>Not available{why ? ` (${why})` : ""}</span>;
}

const SOURCE: Record<string, [string, string]> = {
  lab: ["Lighthouse lab test", "Simulated load in Google's data centre; varies between runs."],
  field: ["Real users (Chrome UX Report)", "75th percentile of real Chrome visits over the previous 28 days."],
  gsc: ["Google-indexed data (Search Console)", "What Google knows from its index and crawls; not a live test."],
  schema: ["Internal schema validator", "WebAudit Pro checks against Google's documented requirements; not an official Google test."],
  webaudit: ["WebAudit Pro live crawl", "Measured by WebAudit Pro's own browser during the audit."],
};
export function Source({ kind, when }: { kind: keyof typeof SOURCE; when?: string | null }) {
  const [title, hint] = SOURCE[kind];
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600" title={hint}>
      {title}{when ? ` · ${new Date(when).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}
    </span>
  );
}

export function ProjectPicker({ projects, selected, extra }: { projects: { id: string; name: string }[]; selected?: string; extra?: ReactNode }) {
  return (
    <form method="get" className="mb-5 flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 sm:max-w-sm">
        <label htmlFor="project" className={label}>Website</label>
        <select id="project" name="project" defaultValue={selected} className={`${input} mt-1`}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {extra}
      <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Show</button>
    </form>
  );
}

const TABS = [
  ["", "SEO Overview"], ["pagespeed", "PageSpeed Insights"], ["structured-data", "Structured Data"], ["search-console", "Search Console Performance"],
  ["inspection", "URL Inspection"], ["sitemaps", "Sitemaps"], ["connections", "Google Connections"], ["history", "SEO History & Reports"],
] as const;

export function GoogleTabs({ active, project }: { active: (typeof TABS)[number][0]; project?: string }) {
  return (
    <nav aria-label="Google SEO & Performance" className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map(([slug, text]) => (
        <Link
          key={slug}
          href={`/google${slug ? `/${slug}` : ""}${project ? `?project=${project}` : ""}`}
          aria-current={active === slug ? "page" : undefined}
          className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active === slug ? "border-navy-900 font-semibold text-navy-900" : "border-transparent text-slate-600 hover:text-navy-900")}
        >
          {text}
        </Link>
      ))}
    </nav>
  );
}

export const fmtMs = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? null : `${(n * 100).toFixed(1)}%`);
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? null : n.toLocaleString("en-US"));

/** Change between two measurements with a variability note, e.g. "+6 (beyond normal variation)". */
export function Delta({ before, after, unit = "", lowerIsBetter = false, noise = 0 }: { before: number | null | undefined; after: number | null | undefined; unit?: string; lowerIsBetter?: boolean; noise?: number }) {
  if (before === null || before === undefined || after === null || after === undefined) return <Unavailable />;
  const d = after - before;
  const better = lowerIsBetter ? d < 0 : d > 0;
  const withinNoise = Math.abs(d) <= noise;
  return (
    <span className={cx("tabular text-xs", withinNoise ? "text-slate-500" : better ? "text-ok" : "text-sev-high")} title={withinNoise ? "Within normal run-to-run variation" : undefined}>
      {d > 0 ? "+" : ""}{Number.isInteger(d) ? d : d.toFixed(unit === "" ? 3 : 0)}{unit}{withinNoise ? " (≈ normal variation)" : ""}
    </span>
  );
}

/** The one Search Console status (BUG-02), rendered the same way on every screen. */
export function GscStatusNotice({ status, compact = false }: { status: GscStatus; compact?: boolean }) {
  const tone = status.state === "ready" ? "border-green-300 bg-ok-bg text-ok" : status.state === "api-error" ? "border-red-300 bg-sev-high-bg text-sev-high" : "border-amber-300 bg-sev-med-bg text-sev-med";
  return (
    <div role="status" className={cx("rounded-md border px-3 py-2 text-sm", tone)} data-testid="gsc-status" data-state={status.state}>
      <strong>{status.label}.</strong>{" "}
      {!compact && <span className="text-slate-800">{status.detail}</span>}
      {status.action && <> <Link href={status.action.href} className="underline">{status.action.label}</Link></>}
      {status.technical && (
        <details className="mt-1 text-xs text-slate-700">
          <summary className="cursor-pointer">Technical details (admins)</summary>
          <p className="mt-1 break-words font-mono">{status.technical}</p>
        </details>
      )}
    </div>
  );
}
