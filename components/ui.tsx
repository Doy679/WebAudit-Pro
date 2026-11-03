import Link from "next/link";
import type { ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-md bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50",
  secondary: "inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50",
  danger: "inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-sev-high hover:bg-sev-high-bg disabled:opacity-50",
  ghost: "inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-accent-600 hover:bg-accent-50",
};

export const input = "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-accent-500 focus:outline-none";
export const label = "block text-sm font-medium text-slate-700";
export const hint = "mt-1 text-xs text-slate-500";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-navy-900">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: "high" | "ok" }) {
  const body = (
    <>
      <div className={cx("tabular text-2xl font-semibold", tone === "high" ? "text-sev-high" : tone === "ok" ? "text-ok" : "text-navy-900")}>{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
    </>
  );
  const cls = "block rounded-lg border border-slate-200 bg-white px-4 py-3";
  return href ? <Link href={href} className={cx(cls, "hover:border-accent-500")}>{body}</Link> : <div className={cls}>{body}</div>;
}

const SEVERITY: Record<string, string> = {
  high: "bg-sev-high-bg text-sev-high",
  medium: "bg-sev-med-bg text-sev-med",
  low: "bg-sev-low-bg text-sev-low",
};
export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", SEVERITY[severity] ?? SEVERITY.low)}>{severity}</span>;
}

export const KIND_LABEL: Record<string, string> = { confirmed: "Confirmed", recommendation: "Recommendation", "needs-review": "Needs review" };
export function KindBadge({ kind }: { kind: string }) {
  const cls = kind === "confirmed" ? "bg-navy-900 text-white" : kind === "recommendation" ? "bg-accent-50 text-accent-600" : "bg-slate-100 text-slate-700 ring-1 ring-slate-300";
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>{KIND_LABEL[kind] ?? kind}</span>;
}

export const STATUS_LABEL: Record<string, string> = {
  unverified: "Unverified", confirmed: "Verified", false_positive: "False positive",
  pending: "Pending", approved: "Approved", revision_requested: "Revision requested", rejected: "Rejected",
  todo: "To do", in_progress: "In progress", done: "Done", wont_fix: "Won't fix",
  running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled",
  new: "New", still_present: "Still present", changed: "Changed", resolved: "Resolved", reopened: "Reopened", unable_to_verify: "Unable to verify",
};
const STATUS_TONE: Record<string, string> = {
  confirmed: "text-ok bg-ok-bg", approved: "text-ok bg-ok-bg", done: "text-ok bg-ok-bg", completed: "text-ok bg-ok-bg", resolved: "text-ok bg-ok-bg",
  false_positive: "text-slate-600 bg-slate-100", rejected: "text-sev-high bg-sev-high-bg", failed: "text-sev-high bg-sev-high-bg",
  new: "text-sev-high bg-sev-high-bg", reopened: "text-sev-high bg-sev-high-bg",
  revision_requested: "text-sev-med bg-sev-med-bg", changed: "text-sev-med bg-sev-med-bg", running: "text-accent-600 bg-accent-50",
  in_progress: "text-accent-600 bg-accent-50", cancelled: "text-slate-600 bg-slate-100", unable_to_verify: "text-slate-600 bg-slate-100",
};
export function StatusPill({ status, label: text }: { status: string; label?: string }) {
  return (
    <span className={cx("inline-block rounded px-1.5 py-0.5 text-xs font-medium", STATUS_TONE[status] ?? "text-slate-700 bg-slate-100")}>
      {text ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-navy-900">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const cls = {
    info: "border-accent-500/30 bg-accent-50 text-navy-800",
    warn: "border-amber-300 bg-sev-med-bg text-sev-med",
    error: "border-red-300 bg-sev-high-bg text-sev-high",
    ok: "border-green-300 bg-ok-bg text-ok",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", cls)}>{children}</div>;
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "–";

export const shortUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname === "/" ? x.host : x.pathname + x.search;
  } catch {
    return u;
  }
};
