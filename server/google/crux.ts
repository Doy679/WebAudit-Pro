// Chrome UX Report API adapter (https://developer.chrome.com/docs/crux/api). Independent of PageSpeed Insights,
// because Google has announced that PSI will stop returning real-user CrUX data. Requires an API key with the
// Chrome UX Report API enabled. 404 means Google has no field data for that URL/origin (not an error to hide).
import type { CwvCategory, FieldData, FieldKey, Strategy } from "./types";

const THRESHOLDS: Record<FieldKey, [number, number]> = {
  lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000], ttfb: [800, 1800],
};

export function cruxCategory(metric: FieldKey, p75: number): CwvCategory {
  const [good, poor] = THRESHOLDS[metric];
  return p75 <= good ? "good" : p75 > poor ? "poor" : "needs-improvement";
}

const API_KEYS: Record<string, FieldKey> = {
  largest_contentful_paint: "lcp", interaction_to_next_paint: "inp", cumulative_layout_shift: "cls",
  first_contentful_paint: "fcp", experimental_time_to_first_byte: "ttfb",
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ymd = (d?: Json) => (d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : "");

export function parseCruxRecord(json: Json): FieldData {
  const rec = json.record ?? {};
  const metrics: FieldData["metrics"] = {};
  for (const [name, m] of Object.entries<Json>(rec.metrics ?? {})) {
    const key = API_KEYS[name];
    const raw = m?.percentiles?.p75;
    if (!key || raw === undefined || raw === null) continue;
    const p75 = Number(raw);
    if (!Number.isFinite(p75)) continue;
    metrics[key] = { p75, unit: key === "cls" ? "unitless" : "ms", category: cruxCategory(key, p75) };
  }
  const period = rec.collectionPeriod ? `${ymd(rec.collectionPeriod.firstDate)} to ${ymd(rec.collectionPeriod.lastDate)}` : undefined;
  return { source: "crux-api", scope: rec.key?.origin ? "origin" : "url", period, metrics };
}

export class CruxNotFoundError extends Error {}

/** Queries the CrUX API for a URL (falls back to origin when the URL has no data). */
export async function queryCrux(url: string, strategy: Strategy, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<FieldData | null> {
  const formFactor = strategy === "mobile" ? "PHONE" : "DESKTOP";
  for (const target of [{ url }, { origin: new URL(url).origin }]) {
    const res = await fetchImpl(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...target, formFactor }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) continue;
    const body = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new Error(`Chrome UX Report API error (HTTP ${res.status}): ${body?.error?.message ?? ""}`.trim());
    return parseCruxRecord(body);
  }
  return null; // Google has no field data for this URL or origin.
}
