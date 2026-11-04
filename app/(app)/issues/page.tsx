import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { filterOptions, listIssues } from "@/server/issues";
import { parseIssueSearchParams, QUICK_FILTERS } from "@/server/issue-filters";
import { listViews } from "@/server/saved-views";
import { explainIssue } from "@/server/explain";
import { listProjects } from "@/server/projects";
import { listRuns } from "@/server/runs";
import { all } from "@/server/db";
import { can, projectScope } from "@/server/permissions";
import { bulkReviewAction, deleteViewAction, saveViewAction } from "@/app/actions";
import { ActionForm, SelectAll, Submit } from "@/components/forms";
import { btn, cx, Empty, fmtDate, input, KindBadge, PageHeader, SeverityBadge, shortUrl, StatusPill } from "@/components/ui";
import { PROVIDER_LABEL, TYPE_LABEL } from "@/components/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Issues" };

type SP = Record<string, string | undefined>;

export default async function IssuesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // Every URL parameter is validated here; empty values (from the filter form) mean "no filter".
  const filters = parseIssueSearchParams(sp);
  const { rows, total, page, pageSize } = listIssues(user, filters);
  const opts = filterOptions(user, filters.runId, filters.projectId);
  const projects = listProjects(user);
  const runs = listRuns(user, { projectId: filters.projectId, status: "completed", limit: 50 });
  const scope = projectScope(user, "m.project_id");
  const people = all<{ id: string; name: string }>(
    `SELECT DISTINCT u.id, u.name FROM project_members m JOIN users u ON u.id = m.user_id WHERE ${scope.sql} AND u.disabled = 0 ORDER BY u.name`, ...scope.params);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (patch: SP) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/issues?${next.toString()}`;
  };
  const reviewer = can(user, "issue:review");
  const views = listViews(user);
  // The current filter set (without paging), carried to issue pages so "Back" returns here.
  const current = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  const detail = (id: string) => `/issues/${id}${current ? `?from=${encodeURIComponent(current)}` : ""}`;
  const quick = filters.quick ?? "all";
  const ADVANCED = ["url", "type", "viewport", "kind", "verification", "review", "assignee", "provider", "conf"];
  const advancedOpen = ADVANCED.some((k) => sp[k]);
  const first = total ? (page - 1) * pageSize + 1 : 0;
  // A custom report needs a single audit: the filtered one, or the only one on this page.
  const reportRun = filters.runId ?? (new Set(rows.map((r) => r.run_id)).size === 1 ? rows[0]?.run_id : undefined);

  const select = (name: string, labelText: string, options: [string, string][], allLabel: string | null = "All") => (
    <label className="block text-xs font-medium text-slate-600">
      {labelText}
      <select name={name} defaultValue={sp[name] ?? ""} className={cx(input, "mt-1 py-1.5")}>
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <PageHeader
        title="Issues"
        subtitle={<>Problems found by your audits{sp.run ? " (selected audit)" : ", from each website's latest audit"}. A problem repeated on many pages is listed once. Open any issue for a plain-language explanation, screenshot and recommended fix.</>}
      />

      <nav aria-label="Quick filters" className="mb-3 flex flex-wrap gap-1.5" data-testid="quick-filters">
        {QUICK_FILTERS.map((q) => (
          <Link key={q.key} href={qs({ quick: q.key === "all" ? undefined : q.key, page: undefined })} aria-current={quick === q.key ? "page" : undefined}
            className={cx("rounded-full border px-3 py-1.5 text-sm", quick === q.key ? "border-navy-900 bg-navy-900 font-medium text-white" : "border-slate-300 bg-white text-slate-700 hover:border-accent-500")}>
            {q.label}
          </Link>
        ))}
      </nav>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="saved-views">
        <span className="text-slate-600">Saved views:</span>
        {views.length === 0 && <span className="text-slate-500">none yet</span>}
        {views.map((v) => (
          <span key={v.id} className="inline-flex items-center rounded-full border border-slate-300 bg-white">
            <Link href={`/issues?${v.query}`} className="py-1 pl-3 pr-1 text-accent-600 hover:underline">{v.name}</Link>
            <form action={deleteViewAction}><input type="hidden" name="viewId" value={v.id} />
              <button className="rounded-full px-2 py-1 text-slate-500 hover:text-sev-high" aria-label={`Delete saved view ${v.name}`} title="Delete">×</button>
            </form>
          </span>
        ))}
        {current && (
          <details className="relative">
            <summary className="cursor-pointer rounded px-2 py-1 text-accent-600 hover:bg-accent-50">Save current filters…</summary>
            <form action={saveViewAction} className="absolute z-10 mt-1 flex w-72 max-w-[calc(100vw-2rem)] gap-2 rounded-md border border-slate-200 bg-white p-2 shadow">
              <input type="hidden" name="query" value={current} />
              <label className="sr-only" htmlFor="view-name">View name</label>
              <input id="view-name" name="name" required maxLength={80} placeholder="e.g. Mobile, high priority" className={cx(input, "py-1.5")} />
              <button className={btn.primary}>Save</button>
            </form>
          </details>
        )}
      </div>

      <form method="get" className="mb-4 rounded-lg border border-slate-200 bg-white p-3" aria-label="Filter findings">
        {filters.quick && <input type="hidden" name="quick" value={filters.quick} />}
        {filters.types && <input type="hidden" name="types" value={filters.types.join(",")} />}
        {filters.types && (
          <p className="mb-2 text-sm text-slate-700" data-testid="types-filter">
            Showing categories: <strong>{filters.types.map((t) => TYPE_LABEL[t] ?? t).join(", ")}</strong>{" "}
            <Link href={qs({ types: undefined, page: undefined })} className="text-accent-600 underline">Show all categories</Link>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <label className="col-span-2 block text-xs font-medium text-slate-600">
            Search
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Words in the title, page address, ID…" className={cx(input, "mt-1 py-1.5")} />
          </label>
          {select("project", "Website", projects.map((p) => [p.id, p.name]))}
          {select("run", "Audit", runs.map((r) => [r.id, `${r.project_name}: ${fmtDate(r.created_at)}`]), "Latest")}
          {select("severity", "Severity", [["high", "High"], ["medium", "Medium"], ["low", "Low"]])}
          {select("sort", "Sort by", [["severity", "Severity"], ["confidence", "Confidence"], ["page", "Page"], ["code", "Issue ID"], ["updated", "Recently updated"]], null)}
        </div>
        <details className="mt-3" open={advancedOpen}>
          <summary className="cursor-pointer text-sm font-medium text-accent-600">More filters{advancedOpen ? " (in use)" : ""}</summary>
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {select("url", "Page", opts.pages.map((u) => [u, shortUrl(u)]))}
          {select("type", "Category", opts.types.map((t) => [t, TYPE_LABEL[t] ?? t]))}
          {select("viewport", "Viewport", opts.viewports.map((v) => [String(v), `${v}px`]))}
          {select("kind", "Classification", [["confirmed", "Confirmed"], ["recommendation", "Recommendation"], ["needs-review", "Needs review"]])}
          {select("verification", "Verification", [["unverified", "Unverified"], ["confirmed", "Verified"], ["false_positive", "False positive"]])}
          {select("review", "Review status", [["pending", "Pending"], ["approved", "Approved"], ["revision_requested", "Revision requested"], ["rejected", "Rejected"]])}
          {select("assignee", "Assigned developer", [["none", "Unassigned"], ...people.map((p) => [p.id, p.name] as [string, string])])}
          {select("provider", "Source", opts.providers.map((p) => [p, PROVIDER_LABEL[p] ?? p]))}
          {select("conf", "Min confidence", [["0.5", "50%+"], ["0.7", "70%+"], ["0.85", "85%+"]])}
        </div>
        </details>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className={btn.primary}>Apply filters</button>
          <Link href="/issues" className={btn.secondary}>Clear all</Link>
          <span className="text-sm text-slate-600" aria-live="polite">{total ? `Showing ${first}–${first + rows.length - 1} of ${total}` : "No matches"}</span>
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty title={current ? "No issues match these filters" : "No issues yet"}>
          {current
            ? <>Try another quick filter, or <Link href="/issues" className="text-accent-600 underline">clear all filters</Link>.</>
            : <>Issues appear here after an audit finishes. <Link href="/audits/new" className="text-accent-600 underline">Start an audit</Link></>}
        </Empty>
      ) : (
        <ActionForm action={bulkReviewAction}>
          {reviewer && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm">
              <span className="font-medium text-slate-700">With selected:</span>
              <label className="sr-only" htmlFor="bulk-action">Bulk action</label>
              <select id="bulk-action" name="action" required className={cx(input.replace("w-full", "w-auto"), "py-1.5")} defaultValue="">
                <option value="" disabled>Choose an action…</option>
                <option value="confirm">Confirm finding</option>
                <option value="false_positive">Mark false positive</option>
                <option value="approve">Approve recommendation</option>
                <option value="request_revision">Request revision</option>
                <option value="reject">Reject recommendation</option>
                <option value="assign">Assign developer →</option>
              </select>
              <label className="sr-only" htmlFor="bulk-assignee">Developer</label>
              <select id="bulk-assignee" name="assigneeId" className={cx(input.replace("w-full", "w-auto"), "max-w-full py-1.5")}>
                <option value="">(for Assign) Unassigned</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-700"><input type="checkbox" name="confirmLarge" /> Yes, apply to all selected <span className="text-slate-500">(needed above 10)</span></label>
              <Submit variant="secondary">Apply</Submit>
              {reportRun && can(user, "export:create") && (
                <>
                  <input type="hidden" name="run" value={reportRun} />
                  <button type="submit" formAction="/reports" formMethod="get" className={cx(btn.secondary, "ml-auto")} data-testid="report-from-selected">Create report from selected</button>
                </>
              )}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {reviewer && <th className="w-8 px-3 py-2"><SelectAll name="ids" /></th>}
                  <th className="px-3 py-2">ID</th><th className="px-3 py-2">Finding</th><th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Class</th><th className="px-3 py-2 text-right">Conf.</th><th className="px-3 py-2">Page</th>
                  <th className="px-3 py-2">Viewports</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Assignee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((i) => (
                  <tr key={i.id} className={cx("hover:bg-slate-50", i.verification_status === "false_positive" && "opacity-60")}>
                    {reviewer && <td className="px-3 py-2"><input type="checkbox" name="ids" value={i.id} aria-label={`Select ${i.code}`} /></td>}
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs"><Link href={detail(i.id)} className="text-accent-600 hover:underline">{i.code}</Link></td>
                    <td className="max-w-xs px-3 py-2">
                      <Link href={detail(i.id)} className="font-medium text-navy-900 hover:underline">{i.title}</Link>
                      {(() => {
                        const e = explainIssue(i);
                        const same = e.what.replace(/\.$/, "").toLowerCase() === i.title.replace(/\.$/, "").toLowerCase();
                        return <div className="text-xs text-slate-600">{same ? null : <>{e.what} </>}<span className="text-slate-500">Fix by: {e.who}</span></div>;
                      })()}
                      {i.provider !== "webaudit" && <div className="text-[11px] text-accent-600">{PROVIDER_LABEL[i.provider] ?? i.provider}{i.metric_key ? ` · ${i.metric_key}` : ""}</div>}
                      {i.pages.length > 1 && <div className="text-xs text-sev-med">Shared · {i.pages.length} pages{i.instance_count > i.pages.length ? `, ${i.instance_count} instances` : ""}</div>}
                    </td>
                    <td className="px-3 py-2"><SeverityBadge severity={i.severity} /></td>
                    <td className="px-3 py-2"><KindBadge kind={i.kind} /></td>
                    <td className="tabular px-3 py-2 text-right">{Math.round(i.confidence * 100)}%</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-xs">{shortUrl(i.url)}</td>
                    <td className="px-3 py-2 text-xs">{i.viewports.join(", ")}</td>
                    <td className="space-y-1 px-3 py-2">
                      <StatusPill status={i.verification_status} />{" "}
                      <StatusPill status={i.review_status} />
                      {i.client_decision && <div className="text-xs text-slate-500">Client: {i.client_decision.replace("_", " ")}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">{i.assignee_name ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      )}

      {total > pageSize && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-600">Page {page} of {pages} · {total} issues</span>
          <span className="flex gap-2">
            {page > 1 && <Link className={btn.secondary} href={qs({ page: String(page - 1) })}>Previous</Link>}
            {page < pages && <Link className={btn.secondary} href={qs({ page: String(page + 1) })}>Next</Link>}
          </span>
        </nav>
      )}
    </>
  );
}
