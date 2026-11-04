// Google PageSpeed Insights API v5 adapter (https://developers.google.com/speed/docs/insights/v5/get-started).
// Google fetches the page itself; we only call googleapis.com. Lab (Lighthouse) and field (CrUX) data are kept apart.
import type { FieldData, FieldKey, FieldMetric, LabMetric, LhAudit, ProviderFinding, PsiResult, Strategy } from "./types";
import { cruxCategory } from "./crux";

export const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

export class PsiQuotaError extends Error {}
export class PsiConfigError extends Error {}
export class PsiPageError extends Error {}
export class PsiTransientError extends Error {}

export const psiReportUrl = (url: string, strategy: Strategy) =>
  `https://pagespeed.web.dev/report?url=${encodeURIComponent(url)}&form_factor=${strategy}`;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const score100 = (s: unknown) => (typeof s === "number" ? Math.round(s * 100) : null);

const UNIT: Record<string, LabMetric["unit"]> = { millisecond: "ms", unitless: "unitless" };
function lab(audits: Json, id: string): LabMetric | undefined {
  const a = audits?.[id];
  if (!a || typeof a.numericValue !== "number") return undefined;
  return { value: Math.round(a.numericValue * 1000) / 1000, unit: UNIT[a.numericUnit] ?? "ms", display: a.displayValue ?? String(a.numericValue), score: typeof a.score === "number" ? a.score : null };
}

const FIELD_KEYS: Record<string, FieldKey> = {
  LARGEST_CONTENTFUL_PAINT_MS: "lcp", INTERACTION_TO_NEXT_PAINT: "inp", CUMULATIVE_LAYOUT_SHIFT_SCORE: "cls",
  FIRST_CONTENTFUL_PAINT_MS: "fcp", EXPERIMENTAL_TIME_TO_FIRST_BYTE: "ttfb",
};
const PSI_CAT: Record<string, FieldMetric["category"]> = { FAST: "good", AVERAGE: "needs-improvement", SLOW: "poor" };

function field(exp: Json | undefined, scope: "url" | "origin"): FieldData | null {
  if (!exp?.metrics || !Object.keys(exp.metrics).length) return null;
  // BUG-05: when a page lacks enough traffic, PageSpeed puts the whole site's data in loadingExperience and marks
  // it origin_fallback. That is site-level data, not this page's.
  if (scope === "url" && exp.origin_fallback === true) scope = "origin";
  const metrics: FieldData["metrics"] = {};
  for (const [name, m] of Object.entries<Json>(exp.metrics)) {
    const key = FIELD_KEYS[name];
    if (!key || typeof m?.percentile !== "number") continue;
    // The PSI API reports CLS ×100 as an integer.
    const p75 = key === "cls" ? m.percentile / 100 : m.percentile;
    metrics[key] = { p75, unit: key === "cls" ? "unitless" : "ms", category: PSI_CAT[m.category] ?? cruxCategory(key, p75) };
  }
  if (!Object.keys(metrics).length) return null;
  return { source: "psi-crux", scope, overall: PSI_CAT[exp.overall_category] ?? null, metrics };
}

function toAudit(a: Json): LhAudit {
  const items = Array.isArray(a.details?.items) ? a.details.items : [];
  return {
    id: a.id, title: a.title ?? a.id, description: a.description ?? "", score: typeof a.score === "number" ? a.score : null,
    displayValue: a.displayValue, savingsMs: a.details?.overallSavingsMs, savingsBytes: a.details?.overallSavingsBytes,
    metricSavings: a.metricSavings && Object.keys(a.metricSavings).length ? a.metricSavings : undefined,
    items: items.slice(0, 5).map((i: Json) => ({
      url: typeof i.url === "string" ? i.url : undefined, totalBytes: i.totalBytes, wastedBytes: i.wastedBytes, wastedMs: i.wastedMs,
    })),
  };
}

const failing = (a: Json | undefined) => !!a && typeof a.score === "number" && a.score < 0.9 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual";

export function parsePsi(json: Json, strategy: Strategy): PsiResult {
  const lr = json.lighthouseResult;
  if (!lr) throw new PsiPageError("PageSpeed Insights returned no Lighthouse result.");
  if (lr.runtimeError?.code && lr.runtimeError.code !== "NO_ERROR") {
    throw new PsiPageError(`Lighthouse could not analyse the page: ${lr.runtimeError.message ?? lr.runtimeError.code}`);
  }
  const cats = lr.categories ?? {};
  const audits = lr.audits ?? {};
  const refs = (cat: string) => (cats[cat]?.auditRefs ?? []) as { id: string; group?: string }[];
  const perfRefs = refs("performance");
  const opportunityIds = perfRefs.filter((r) => r.group === "insights" || r.group === "load-opportunities" || audits[r.id]?.details?.type === "opportunity").map((r) => r.id);
  const diagnosticIds = perfRefs.filter((r) => r.group === "diagnostics" && !opportunityIds.includes(r.id)).map((r) => r.id);
  const isOpportunity = (id: string) => {
    const a = audits[id];
    return failing(a) && (a.scoreDisplayMode === "metricSavings" || a.details?.type === "opportunity" || !!a.metricSavings);
  };

  return {
    requestedUrl: lr.requestedUrl ?? json.id,
    finalUrl: lr.finalDisplayedUrl ?? lr.finalUrl ?? lr.requestedUrl ?? json.id,
    strategy,
    analysisTimestamp: json.analysisUTCTimestamp ?? lr.fetchTime,
    fetchTime: lr.fetchTime,
    lighthouseVersion: lr.lighthouseVersion,
    scores: {
      performance: score100(cats.performance?.score), accessibility: score100(cats.accessibility?.score),
      bestPractices: score100(cats["best-practices"]?.score), seo: score100(cats.seo?.score),
    },
    lab: {
      lcp: lab(audits, "largest-contentful-paint"), fcp: lab(audits, "first-contentful-paint"), cls: lab(audits, "cumulative-layout-shift"),
      tbt: lab(audits, "total-blocking-time"), si: lab(audits, "speed-index"),
    },
    field: field(json.loadingExperience, "url"),
    originField: field(json.originLoadingExperience, "origin"),
    opportunities: [...opportunityIds, ...diagnosticIds].filter(isOpportunity).map((id) => toAudit(audits[id])),
    diagnostics: diagnosticIds.filter((id) => failing(audits[id]) && !isOpportunity(id)).map((id) => toAudit(audits[id])),
    failedChecks: {
      accessibility: refs("accessibility").map((r) => audits[r.id]).filter(failing).map(toAudit),
      bestPractices: refs("best-practices").map((r) => audits[r.id]).filter(failing).map(toAudit),
      seo: refs("seo").map((r) => audits[r.id]).filter(failing).map(toAudit),
    },
    runWarnings: Array.isArray(lr.runWarnings) ? lr.runWarnings.map(String) : [],
  };
}

export interface PsiOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls the PSI API with retry/backoff for transient errors; quota-per-day and bad keys fail fast. */
export async function runPsi(url: string, strategy: Strategy, opts: PsiOptions): Promise<PsiResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const q = new URLSearchParams({ url, strategy });
  for (const c of CATEGORIES) q.append("category", c);
  q.set("key", opts.apiKey);
  const endpoint = `${PSI_ENDPOINT}?${q.toString()}`;
  const retries = opts.retries ?? 2;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(endpoint, { signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) });
    } catch (e) {
      if (attempt >= retries) throw new PsiTransientError(`PageSpeed Insights did not respond (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message}).`);
      await sleep((opts.backoffMs ?? 2000) * 2 ** attempt);
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as Json;
    if (res.ok) return parsePsi(body, strategy);

    const message: string = body?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429 && /per day/i.test(message)) throw new PsiQuotaError(`PageSpeed Insights daily quota reached. ${message}`);
    if (res.status === 400 && /api key/i.test(message)) throw new PsiConfigError("The PageSpeed Insights API key was rejected. Check it in Google Connections.");
    if (res.status === 403) throw new PsiConfigError(`PageSpeed Insights refused the request: ${message}`);
    if (res.status === 400 || res.status === 404) throw new PsiPageError(`PageSpeed Insights could not analyse this URL: ${message}`);
    if (attempt >= retries) {
      if (res.status === 429) throw new PsiQuotaError(`PageSpeed Insights rate limit reached. Try again later. ${message}`);
      throw new PsiTransientError(`PageSpeed Insights failed (HTTP ${res.status}): ${message}`);
    }
    await sleep((opts.backoffMs ?? 2000) * 2 ** attempt);
  }
}

const kib = (b?: number) => (b ? `${Math.round(b / 1024).toLocaleString("en-US")} KiB` : "");
const LAB_LABEL: Record<string, [string, string, string]> = {
  "largest-contentful-paint": ["lcp", "Largest Contentful Paint (lab)", "≤ 2.5 s"],
  "cumulative-layout-shift": ["cls", "Cumulative Layout Shift (lab)", "≤ 0.1"],
  "total-blocking-time": ["tbt", "Total Blocking Time (lab)", "≤ 200 ms"],
};
const FIELD_LABEL: Record<FieldKey, [string, string]> = {
  lcp: ["Largest Contentful Paint", "≤ 2.5 s at p75"], inp: ["Interaction to Next Paint", "≤ 200 ms at p75"], cls: ["Cumulative Layout Shift", "≤ 0.1 at p75"],
  fcp: ["First Contentful Paint", "≤ 1.8 s at p75"], ttfb: ["Time to First Byte", "≤ 0.8 s at p75"],
};
export const fmtFieldValue = (m: FieldMetric) =>
  m.unit === "unitless" ? String(m.p75) : m.p75 >= 1000 ? `${(m.p75 / 1000).toFixed(1)} s` : `${Math.round(m.p75)} ms`;
const fmtField = (k: FieldKey, m: FieldMetric) => `${fmtFieldValue(m)} p75 (${m.category.replace("-", " ")}, ${k.toUpperCase()})`;

/**
 * Findings from one PSI result. Opportunities and poor lab metrics are recommendations (lab results vary run to run);
 * poor real-user CrUX metrics are confirmed field measurements. Accessibility/SEO audits are left to the internal
 * engine (axe-core and SEO checks) to avoid duplicates.
 */
export function psiFindings(r: PsiResult, pageUrl: string): ProviderFinding[] {
  const base = { provider: "psi" as const, url: pageUrl, strategy: r.strategy, providerTimestamp: r.analysisTimestamp, sourceRef: psiReportUrl(pageUrl, r.strategy) };
  const out: ProviderFinding[] = [];

  for (const o of r.opportunities) {
    const savings = o.displayValue ?? [o.savingsMs ? `${Math.round(o.savingsMs)} ms` : "", kib(o.savingsBytes)].filter(Boolean).join(", ");
    const big = (o.savingsMs ?? Math.max(0, ...Object.values(o.metricSavings ?? {}))) >= 1000 || (o.savingsBytes ?? 0) >= 500 * 1024;
    out.push({
      ...base, type: "performance", kind: "recommendation", severity: big ? "medium" : "low", confidence: 0.7,
      rule: `psi:${o.id}`, metricKey: o.id, title: `${o.title} (${r.strategy})`,
      current: savings || null, proposed: "Apply the Lighthouse recommendation, then re-test",
      recommendation: o.description.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
      evidence: o.items.map((i) => [i.url, i.wastedBytes ? `${kib(i.wastedBytes)} wasted` : "", i.wastedMs ? `${Math.round(i.wastedMs)} ms` : ""].filter(Boolean).join(" · ")).join("\n") || savings,
      docUrl: o.description.match(/\((https:[^)]+)\)/)?.[1],
    });
  }

  for (const [id, [key, label, target]] of Object.entries(LAB_LABEL)) {
    const m = r.lab[key as "lcp" | "cls" | "tbt"];
    if (!m || m.score === null || m.score >= 0.5) continue;
    out.push({
      ...base, type: "performance", kind: "recommendation", severity: m.score < 0.25 ? "medium" : "low", confidence: 0.6,
      rule: `psi:lab:${id}`, metricKey: `lab:${id}`, title: `Slow ${label} on ${r.strategy}`,
      current: m.display, proposed: target, evidence: `Lighthouse ${r.lighthouseVersion} lab run, ${r.fetchTime}. Lab results vary between runs.`,
      recommendation: "Investigate the performance opportunities for this page; lab metrics are a simulated load and vary between runs.",
    });
  }

  if (r.field) {
    // Whole-site data becomes one finding per metric + device for the site (same fingerprint from every page).
    const site = r.field.scope === "origin";
    let origin = pageUrl;
    try { origin = `${new URL(pageUrl).origin}/`; } catch { /* keep page */ }
    for (const [k, m] of Object.entries(r.field.metrics) as [FieldKey, FieldMetric][]) {
      if (m.category !== "poor") continue;
      out.push({
        ...base, ...(site ? { url: origin, sourceRef: psiReportUrl(origin, r.strategy) } : {}),
        provider: "psi", type: "cwv", kind: "confirmed", severity: k === "fcp" || k === "ttfb" ? "medium" : "high", confidence: 0.9,
        rule: site ? `crux:origin:${k}` : `crux:${k}`, metricKey: `crux:${k}`,
        title: `Poor real-user ${FIELD_LABEL[k][0]} on ${r.strategy}${site ? " (whole site)" : ""}`,
        current: fmtField(k, m), proposed: FIELD_LABEL[k][1],
        evidence: site
          ? "Chrome UX Report real-user data for the whole site (origin), 75th percentile, previous 28 days, returned by PageSpeed Insights. Google had too few visits to report this page on its own."
          : "Chrome UX Report real-user data for this page (75th percentile, previous 28 days) returned by PageSpeed Insights.",
        recommendation: `Real visitors experience slow ${FIELD_LABEL[k][0]}. Fix the related lab opportunities, then confirm improvement in field data over the following 28 days.`,
      });
    }
  }
  return out;
}
