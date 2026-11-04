import Link from "next/link";
import type { HealthSection } from "@/server/health";
import { cx } from "./ui";

export function WebsiteHealth({ sections, coverage, total }: { sections: HealthSection[]; coverage: number; total: number }) {
  return (
    <section aria-labelledby="health-title" className="rounded-lg border border-slate-200 bg-white" data-testid="website-health">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 id="health-title" className="text-sm font-semibold text-navy-900">WebAudit Pro Website Health</h2>
        <span className="text-xs text-slate-500">{coverage} of {total} areas have data · each area has its own measures; there is no combined score</span>
      </header>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map((s) => (
          <div key={s.key} className="bg-white p-4" data-section={s.key} data-state={s.state}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy-900">{s.title}</h3>
              {s.href && <Link href={s.href} className="text-xs text-accent-600 hover:underline">Open</Link>}
            </div>
            <div className="text-[11px] text-slate-500">{s.source}</div>
            {s.state !== "ok" ? (
              <p className={cx("mt-3 text-sm", s.state === "not-connected" ? "text-sev-med" : "text-slate-500")}>{s.state === "not-connected" ? s.why : <>Not run: {s.why}</>}</p>
            ) : (
              <>
                {s.findings && (
                  <dl className="mt-3 grid grid-cols-3 gap-1 text-center">
                    <div><dt className="text-[10px] uppercase text-slate-500">Confirmed</dt><dd className="tabular text-lg font-semibold">{s.findings.confirmed}</dd></div>
                    <div><dt className="text-[10px] uppercase text-slate-500">Recommend.</dt><dd className="tabular text-lg font-semibold">{s.findings.recommendation}</dd></div>
                    <div><dt className="text-[10px] uppercase text-slate-500">Review</dt><dd className="tabular text-lg font-semibold">{s.findings.needsReview}</dd></div>
                  </dl>
                )}
                {s.metrics.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {s.metrics.map((m) => (
                      <li key={m.label} className="flex justify-between gap-2">
                        <span className="text-slate-600">{m.label}</span>
                        <span className="tabular text-right font-medium" title={m.note}>{m.value ?? <span className="text-xs italic text-slate-400">Not available</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
