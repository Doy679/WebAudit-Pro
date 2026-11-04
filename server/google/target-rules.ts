// PageSpeed monitoring targets: pure rules shared by the server and the browser (no database, no Node APIs).
// A target is a page the project owner wants measured on every PageSpeed run (homepage, state landing pages…).

export type TargetGroup = "homepage" | "state" | "custom";
export type LicensingStatus = "eligible" | "license_pending" | "not_licensed";
/** "no_landing_page": the owner's list has the state but the website has no page for it (e.g. New York). */
export type VerificationStatus = "verified" | "needs_url_review" | "no_landing_page";

export interface TargetSeed {
  url: string | null;
  label: string;
  group: TargetGroup;
  state_code: string | null;
  licensing_status: LicensingStatus;
  verification_status: VerificationStatus;
  verification_note: string;
  verified_at: string;
  selected: boolean;
  sort_order: number;
}

/** Hard cap on URLs per batch, whatever the project's own limit. */
export const BACKEND_BATCH_LIMIT = 10;

/** A target may be measured only if it is selected, has a URL, is licensed and its URL was verified. */
export function isRunnable(t: { selected: boolean; url: string | null; licensing_status: string; verification_status: string }): boolean {
  return t.selected && !!t.url && t.licensing_status === "eligible" && t.verification_status === "verified";
}

/** May this target be ticked at all (selection is still saved separately)? */
export const isSelectable = (t: { url: string | null; licensing_status: string; verification_status: string }) =>
  isRunnable({ ...t, selected: true });

export const batchSize = (projectLimit: number) => Math.max(1, Math.min(BACKEND_BATCH_LIMIT, Math.floor(projectLimit) || 1));

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** "48 URLs selected · Mobile ✓ Desktop ✓ · 96 requests in 5 batches" (devices: 1 = mobile only, 2 = both). */
export function summary(urls: number, devices: { mobile: boolean; desktop: boolean } | number, size: number): string {
  const d = typeof devices === "number" ? { mobile: true, desktop: devices > 1 } : devices;
  const n = (d.mobile ? 1 : 0) + (d.desktop ? 1 : 0);
  const batches = Math.ceil(urls / size);
  return `${urls} URL${urls === 1 ? "" : "s"} selected · Mobile ${d.mobile ? "✓" : "✗"} Desktop ${d.desktop ? "✓" : "✗"} · ${urls * n} request${urls * n === 1 ? "" : "s"} in ${batches} batch${batches === 1 ? "" : "es"}`;
}

export const LICENSING_LABEL: Record<LicensingStatus, string> = { eligible: "Eligible", license_pending: "License Pending", not_licensed: "Not Licensed" };

/** Why a target can't be ticked, in plain words; null when it can. */
export function exclusionReason(t: { url: string | null; licensing_status: string; verification_status: string }): string | null {
  if (t.licensing_status === "license_pending") return "License Pending: excluded until the licence is approved";
  if (t.licensing_status === "not_licensed") return "Not Licensed";
  if (!t.url || t.verification_status === "no_landing_page") return "No landing page";
  if (t.verification_status !== "verified") return "Needs URL Review: the URL must be checked before it can be measured";
  return null;
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

const STATE_CODES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

const REQUIRED = ["order", "state", "url", "licensing_status_owner_supplied", "default_selected", "verification_status", "evidence", "in_yoast_page_sitemap"];

/**
 * Maps the verified URL inventory (CSV) to seed rows. Licensing comes only from the owner-supplied column; the
 * default selection is recomputed from the rules, so a row can never be selected while excluded.
 */
export function inventoryFromCsv(text: string, verifiedAt = "2026-11-04"): TargetSeed[] {
  const [header, ...rows] = parseCsv(text);
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const h of REQUIRED) if (col[h] === undefined) throw new Error(`Inventory CSV is missing the "${h}" column.`);
  return rows.map((r) => {
    const state = r[col.state].trim();
    const url = r[col.url].trim() || null;
    const lic = r[col.licensing_status_owner_supplied].trim().toLowerCase();
    const licensing: LicensingStatus = lic.startsWith("license pending") ? "license_pending" : lic.startsWith("not licensed") ? "not_licensed" : "eligible";
    const ver = r[col.verification_status].trim().toLowerCase();
    const verification: VerificationStatus = !url ? "no_landing_page" : ver === "verified" ? "verified" : "needs_url_review";
    const homepage = state === "(Homepage)";
    const inSitemap = r[col.in_yoast_page_sitemap].trim().toLowerCase();
    const t: TargetSeed = {
      url, label: homepage ? "Homepage" : state, group: homepage ? "homepage" : "state", state_code: homepage ? null : STATE_CODES[state] ?? null,
      licensing_status: licensing, verification_status: verification,
      verification_note: `${r[col.evidence].trim()}${inSitemap === "no" && url ? " · not in the Yoast page sitemap" : ""}`,
      verified_at: verifiedAt, selected: false, sort_order: Number(r[col.order]),
    };
    t.selected = r[col.default_selected].trim().toUpperCase() === "YES" && isSelectable(t);
    return t;
  });
}
