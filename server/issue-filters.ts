// Validates Issues page URL parameters at the boundary. Empty strings mean "no filter";
// unknown values are dropped, so nothing unvalidated ever reaches SQL.
import type { IssueFilters } from "./issues";

const SORTS = ["severity", "confidence", "code", "page", "updated"] as const;
const SEVERITY = ["high", "medium", "low"];
const KIND = ["confirmed", "recommendation", "needs-review"];
const VERIFICATION = ["unverified", "confirmed", "false_positive"];
const REVIEW = ["pending", "approved", "revision_requested", "rejected"];
const IMPLEMENTATION = ["todo", "in_progress", "done", "wont_fix"];
const PROVIDER = ["webaudit", "schema", "psi", "crux", "gsc"];
const TYPE = /^[a-z][a-z0-9-]{1,30}$/;
const ID = /^[0-9a-f-]{36}$|^none$/i;

/** Quick filter chips on the Issues page, in display order. */
export const QUICK_FILTERS = [
  { key: "all", label: "All issues" },
  { key: "high", label: "High priority" },
  { key: "mobile", label: "Mobile" },
  { key: "desktop", label: "Desktop" },
  { key: "a11y", label: "Accessibility" },
  { key: "seo", label: "SEO" },
  { key: "layout", label: "Layout & spacing" },
  { key: "confirmed", label: "Confirmed" },
  { key: "review", label: "Needs review" },
  { key: "client", label: "Awaiting client" },
] as const;
const QUICK = QUICK_FILTERS.map((q) => q.key).filter((k) => k !== "all");

/** URL parameters that make up a filter (what a saved view may store). */
export const FILTER_PARAMS = ["q", "project", "run", "url", "type", "types", "severity", "viewport", "kind", "verification", "review", "implementation", "assignee", "provider", "quick", "conf", "sort", "size"];

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const pick = (v: string | undefined, allowed: readonly string[]) => (v && allowed.includes(v) ? v : undefined);
const int = (v: string | undefined, min: number, max: number) => {
  if (!v || !/^\d+$/.test(v)) return undefined;
  return Math.min(Math.max(Number(v), min), max);
};

export function parseIssueSearchParams(sp: Params): IssueFilters {
  const g = (k: string) => one(sp[k]);
  const conf = g("conf") && /^(0(\.\d+)?|1(\.0+)?)$/.test(g("conf")!) ? Number(g("conf")) : undefined;
  const f: IssueFilters = {
    q: g("q")?.slice(0, 200),
    projectId: g("project") && ID.test(g("project")!) ? g("project") : g("project") && /^[\w-]{1,64}$/.test(g("project")!) ? g("project") : undefined,
    runId: g("run") && /^[\w-]{1,64}$/.test(g("run")!) ? g("run") : undefined,
    url: g("url") && /^https?:\/\//.test(g("url")!) ? g("url") : undefined,
    type: g("type") && TYPE.test(g("type")!) ? g("type") : undefined,
    types: g("types") ? [...new Set(g("types")!.split(",").map((t) => t.trim()).filter((t) => TYPE.test(t)))].slice(0, 12) : undefined,
    severity: pick(g("severity"), SEVERITY),
    viewport: int(g("viewport"), 1, 10_000),
    kind: pick(g("kind"), KIND),
    verification: pick(g("verification"), VERIFICATION),
    review: pick(g("review"), REVIEW),
    implementation: pick(g("implementation"), IMPLEMENTATION),
    assignee: g("assignee") && ID.test(g("assignee")!) ? g("assignee") : undefined,
    provider: pick(g("provider"), PROVIDER),
    quick: pick(g("quick"), QUICK),
    minConfidence: conf && conf > 0 ? conf : undefined,
    sort: (pick(g("sort"), SORTS) as IssueFilters["sort"]) ?? "severity",
    page: Math.max(int(g("page"), 1, 100_000) ?? 1, 1),
    pageSize: int(g("size"), 10, 200) ?? 50,
  };
  // Drop undefined keys so callers (and tests) see only real filters.
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as IssueFilters;
}
