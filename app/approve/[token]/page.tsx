import type { Metadata } from "next";
import { openPackage } from "@/server/approvals";
import { submitClientDecisionsAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { fmtDate, input, label, SeverityBadge } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review audit findings", robots: { index: false, follow: false } };

const DECISIONS = [
  { value: "approved", label: "Approve" },
  { value: "revision_requested", label: "Request revision" },
  { value: "rejected", label: "Reject" },
];

/** Public client page. The secret token in the URL is the only credential; only released findings are shown. */
export default async function ClientApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = openPackage(token);

  if (view.status !== "open") {
    const message = {
      expired: "This approval link has expired. Please ask your project contact for a new link.",
      revoked: "This approval link has been withdrawn. Please contact your project team.",
      invalid: "This approval link isn't valid. Check that you copied the whole link.",
    }[view.status];
    return (
      <main className="flex min-h-screen items-center justify-center bg-navy-50 px-4">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center" data-testid="portal-unavailable">
          <h1 className="text-lg font-semibold text-navy-900">Link unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
        </div>
      </main>
    );
  }

  const pkg = view.package!;
  const img = (issueId: string, which: string) => `/api/portal/${encodeURIComponent(token)}/${issueId}/${which}`;

  return (
    <main className="min-h-screen bg-navy-50">
      <header className="bg-navy-900 px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <div className="text-xs font-semibold uppercase tracking-widest text-accent-500">Website audit · approval</div>
          <h1 className="mt-1 text-2xl font-semibold">{pkg.title}</h1>
          <p className="mt-1 text-sm text-white/75">{pkg.project_name} · audit of {fmtDate(pkg.run_created_at)} · link valid until {fmtDate(pkg.expires_at)}</p>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6">
        {pkg.message && <p className="mb-4 whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-4 text-sm">{pkg.message}</p>}
        <p className="mb-6 text-sm text-slate-600">
          For each finding, compare the current measurement with the proposed change and choose a decision. Approving records your decision only.
          Nothing on your website changes until our team makes the change in a separate, authorized step.
        </p>

        <ActionForm action={submitClientDecisionsAction} className="space-y-6">
          <input type="hidden" name="token" value={token} />
          {view.issues.map((i) => (
            <article key={i.id} className="rounded-lg border border-slate-200 bg-white p-4" data-testid="portal-finding">
              <input type="hidden" name="issueIds" value={i.id} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{i.code}</span>
                <SeverityBadge severity={i.severity} />
                {i.decision && <span className="text-xs text-slate-500">Your last decision: {i.decision.decision.replace("_", " ")}</span>}
              </div>
              <h2 className="mt-1 text-lg font-semibold text-navy-900">{i.title}</h2>
              <p className="break-all text-xs text-slate-500">{i.url}{i.pages.length > 1 ? ` and ${i.pages.length - 1} other page${i.pages.length > 2 ? "s" : ""}` : ""} · {i.viewports.map((v) => `${v}px`).join(", ")}</p>
              {i.evidence.annotated && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img(i.id, "annotated")} alt={`Screenshot for ${i.code} with the affected area outlined`} className="mx-auto mt-3 block h-auto max-w-full rounded border border-slate-200" loading="lazy" />
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-sev-high-bg/60 p-3"><div className="text-xs font-semibold uppercase text-sev-high">Current</div><div className="mt-1 text-sm">{i.current_value ?? "Not measured"}</div></div>
                <div className="rounded-md bg-ok-bg p-3"><div className="text-xs font-semibold uppercase text-ok">Proposed</div><div className="mt-1 text-sm">{i.proposed_value ?? "To be confirmed by our team"}</div></div>
              </div>
              <p className="mt-3 text-sm text-slate-700">{i.recommendation}</p>
              {i.shared_template ? <p className="mt-1 text-xs text-sev-med">This element is shared across pages, so one change updates all of them.</p> : null}
              <fieldset className="mt-3">
                <legend className="text-sm font-medium text-slate-700">Your decision</legend>
                <div className="mt-1 flex flex-wrap gap-4 text-sm">
                  {DECISIONS.map((d) => (
                    <label key={d.value} className="flex items-center gap-1.5">
                      <input type="radio" name={`decision:${i.id}`} value={d.value} defaultChecked={i.decision?.decision === d.value} />{d.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label htmlFor={`comment-${i.id}`} className={`${label} mt-3`}>Comment (optional)</label>
              <textarea id={`comment-${i.id}`} name={`comment:${i.id}`} rows={2} defaultValue={i.decision?.comment ?? ""} className={`${input} mt-1`} />
            </article>
          ))}

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-navy-900">Submit your decisions</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="clientName" className={label}>Your name</label><input id="clientName" name="clientName" required autoComplete="name" className={`${input} mt-1`} /></div>
              <div><label htmlFor="clientEmail" className={label}>Your email</label><input id="clientEmail" name="clientEmail" type="email" required autoComplete="email" className={`${input} mt-1`} /></div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Your name, email and the time are saved with each decision as a record of approval.</p>
            <div className="mt-3"><Submit>Submit decisions</Submit></div>
          </section>
        </ActionForm>
      </div>
    </main>
  );
}
