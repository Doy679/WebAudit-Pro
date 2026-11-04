// Google Search Console: OAuth 2.0 (PKCE, offline access) and read-only API calls.
// Docs: https://developers.google.com/webmaster-tools/ · URL Inspection: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
// Only the webmasters.readonly scope is requested. No submissions, deletions or verification requests are made.
import { createHash, randomBytes } from "node:crypto";
import { GSC_SCOPE } from "./config";
import type { ProviderFinding } from "./types";

/** What went wrong, in terms a user can act on. Google uses HTTP 403 for both a disabled API and a missing property permission. */
export type GoogleErrorKind = "api-disabled" | "permission" | "auth" | "quota" | "network" | "transient" | "other";

export class GscError extends Error {
  kind: GoogleErrorKind = "other";
  /** Google's own error text: shown only to admins under "Technical details". */
  technical?: string;
  projectNumber?: string;
  activationUrl?: string;
}
export class GscAuthError extends GscError { override kind: GoogleErrorKind = "auth"; }
export class GscPermissionError extends GscError { override kind: GoogleErrorKind = "permission"; }
export class GscQuotaError extends GscError { override kind: GoogleErrorKind = "quota"; }
export class GscApiDisabledError extends GscError { override kind: GoogleErrorKind = "api-disabled"; }

export interface GoogleErrorInfo { kind: GoogleErrorKind; message: string; technical: string; projectNumber?: string; activationUrl?: string }

/**
 * Classifies a failed Google API response (BUG-01). SERVICE_DISABLED / accessNotConfigured means the API is
 * switched off in the Google Cloud project: an admin fix, not a Search Console permission problem.
 */
export function classifyGoogleError(status: number, body: Json): GoogleErrorInfo {
  const err = body?.error ?? {};
  const raw = typeof err.message === "string" ? err.message : `HTTP ${status}`;
  const reasons: string[] = [
    ...((err.details ?? []) as Json[]).map((d) => d?.reason),
    ...((err.errors ?? []) as Json[]).map((e) => e?.reason),
  ].filter((r): r is string => typeof r === "string");
  const info = ((err.details ?? []) as Json[]).find((d) => d?.reason === "SERVICE_DISABLED")?.metadata ?? {};
  const technical = `HTTP ${status}${err.status ? ` ${err.status}` : ""}${reasons.length ? ` [${reasons.join(", ")}]` : ""}: ${raw}`;

  if (reasons.includes("SERVICE_DISABLED") || reasons.includes("accessNotConfigured") || /has not been used in project|it is disabled/i.test(raw)) {
    const projectNumber = (String(info.consumer ?? "").match(/projects\/(\d+)/) ?? raw.match(/project (\d+)/))?.[1];
    const activationUrl = typeof info.activationUrl === "string" ? info.activationUrl : raw.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/\S+?(?=\s|$)/)?.[0];
    return {
      kind: "api-disabled", technical, projectNumber, activationUrl,
      message: `The Google Search Console API is turned off in Google Cloud${projectNumber ? ` (project ${projectNumber})` : ""}. An admin needs to enable it, wait a few minutes, then press Retry.`,
    };
  }
  if (status === 401) return { kind: "auth", technical, message: "Google sign-in expired or was revoked. Reconnect Google." };
  if (status === 429 || reasons.some((r) => /rateLimitExceeded|quotaExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED/.test(r))) {
    return { kind: "quota", technical, message: "Google's Search Console quota is used up for now. Try again later." };
  }
  if (status === 403) return { kind: "permission", technical, message: "Your Google account doesn't have access to this Search Console property. Ask the property owner to add your Google account in Search Console." };
  if (status >= 500) return { kind: "transient", technical, message: `Google Search Console is temporarily unavailable (HTTP ${status}). Try again in a few minutes.` };
  return { kind: "other", technical, message: `Search Console request failed (HTTP ${status}).` };
}

function errorFrom(info: GoogleErrorInfo): GscError {
  const Cls = { "api-disabled": GscApiDisabledError, permission: GscPermissionError, auth: GscAuthError, quota: GscQuotaError }[info.kind as string] ?? GscError;
  const e = new Cls(info.message);
  e.kind = info.kind;
  e.technical = info.technical;
  e.projectNumber = info.projectNumber;
  e.activationUrl = info.activationUrl;
  return e;
}

type Fetch = typeof fetch;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const b64url = (b: Buffer) => b.toString("base64url");
export function pkcePair() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function authUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId, redirect_uri: p.redirectUri, response_type: "code", scope: GSC_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "false",
    state: p.state, code_challenge: p.challenge, code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

async function tokenRequest(params: Record<string, string>, fetchImpl: Fetch): Promise<Json> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    if (body.error === "invalid_grant") throw new GscAuthError("Google no longer accepts this connection (it was revoked or expired). Reconnect Google.");
    throw new GscError(`Google token request failed: ${body.error_description ?? body.error ?? res.status}`);
  }
  return body;
}

export async function exchangeCode(p: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string }, fetchImpl: Fetch = fetch) {
  const t = await tokenRequest({
    grant_type: "authorization_code", code: p.code, code_verifier: p.verifier,
    client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: p.redirectUri,
  }, fetchImpl);
  if (!String(t.scope ?? "").split(" ").includes(GSC_SCOPE)) throw new GscError("Google did not grant Search Console read access. Reconnect and allow access to Search Console data.");
  if (!t.refresh_token) throw new GscError("Google did not return a refresh token. Remove WebAudit Pro from your Google account's third-party access and connect again.");
  return { accessToken: t.access_token as string, refreshToken: t.refresh_token as string, expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(), scope: t.scope as string };
}

export async function refreshAccess(p: { refreshToken: string; clientId: string; clientSecret: string }, fetchImpl: Fetch = fetch) {
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: p.refreshToken, client_id: p.clientId, client_secret: p.clientSecret }, fetchImpl);
  return { accessToken: t.access_token as string, expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString() };
}

export async function revokeToken(token: string, fetchImpl: Fetch = fetch) {
  await fetchImpl("https://oauth2.googleapis.com/revoke", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(20_000),
  });
}

async function api(accessToken: string, url: string, init: { method?: string; body?: unknown }, fetchImpl: Fetch): Promise<Json> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${accessToken}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const err = new GscError("Couldn't reach Google Search Console. Check the internet connection and try again.");
    err.kind = "network";
    err.technical = (e as Error).message;
    throw err;
  }
  const body = (await res.json().catch(() => ({}))) as Json;
  if (res.ok) return body;
  throw errorFrom(classifyGoogleError(res.status, body));
}

const WM = "https://www.googleapis.com/webmasters/v3";
const site = (property: string) => encodeURIComponent(property);

export interface SiteEntry { siteUrl: string; permissionLevel: string }
export async function listSites(accessToken: string, fetchImpl: Fetch = fetch): Promise<SiteEntry[]> {
  const body = await api(accessToken, `${WM}/sites`, {}, fetchImpl);
  return (body.siteEntry ?? []).map((s: Json) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
}

export interface AnalyticsRow { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
export interface AnalyticsQuery {
  startDate: string; endDate: string; dimensions?: ("query" | "page" | "device" | "country" | "date" | "searchAppearance")[];
  rowLimit?: number; type?: "web" | "image" | "video" | "news" | "discover" | "googleNews"; dataState?: "final" | "all";
}
export async function searchAnalytics(accessToken: string, property: string, q: AnalyticsQuery, fetchImpl: Fetch = fetch): Promise<AnalyticsRow[]> {
  const body = await api(accessToken, `${WM}/sites/${site(property)}/searchAnalytics/query`, { method: "POST", body: { type: "web", ...q } }, fetchImpl);
  return (body.rows ?? []) as AnalyticsRow[];
}

export interface SitemapInfo {
  path: string; type?: string; isPending?: boolean; isSitemapsIndex?: boolean; lastSubmitted?: string; lastDownloaded?: string;
  warnings?: number; errors?: number; contents?: { type: string; submitted?: number; indexed?: number }[];
}
export async function listSitemaps(accessToken: string, property: string, fetchImpl: Fetch = fetch): Promise<SitemapInfo[]> {
  const body = await api(accessToken, `${WM}/sites/${site(property)}/sitemaps`, {}, fetchImpl);
  return (body.sitemap ?? []).map((s: Json) => ({
    path: s.path, type: s.type, isPending: s.isPending, isSitemapsIndex: s.isSitemapsIndex, lastSubmitted: s.lastSubmitted,
    lastDownloaded: s.lastDownloaded, warnings: s.warnings !== undefined ? Number(s.warnings) : undefined,
    errors: s.errors !== undefined ? Number(s.errors) : undefined,
    contents: (s.contents ?? []).map((c: Json) => ({ type: c.type, submitted: c.submitted !== undefined ? Number(c.submitted) : undefined, indexed: c.indexed !== undefined ? Number(c.indexed) : undefined })),
  }));
}

export async function inspectUrl(accessToken: string, property: string, url: string, fetchImpl: Fetch = fetch): Promise<Json> {
  return api(accessToken, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", body: { inspectionUrl: url, siteUrl: property } }, fetchImpl);
}

// ── Scope helpers ─────────────────────────────────────────────────────────────────

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** A property belongs to a project when it is the project's domain property or a URL-prefix property on that domain. */
export function propertyMatchesDomain(property: string, projectDomain: string): boolean {
  if (property.startsWith("sc-domain:")) {
    const d = property.slice(10).toLowerCase();
    return projectDomain === d || projectDomain.endsWith(`.${d}`);
  }
  try {
    return bare(new URL(property).hostname) === projectDomain;
  } catch {
    return false;
  }
}

/** Whether Google would accept this URL for inspection under the property. */
export function propertyCoversUrl(property: string, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (property.startsWith("sc-domain:")) {
    const d = property.slice(10).toLowerCase();
    const h = u.hostname.toLowerCase();
    return h === d || h.endsWith(`.${d}`);
  }
  return url.startsWith(property);
}

// ── Inspection parsing and findings ─────────────────────────────────────────────────

export interface Inspection {
  link: string | null; verdict: string | null; coverageState: string | null; robotsTxtState: string | null; indexingState: string | null;
  lastCrawlTime: string | null; pageFetchState: string | null; googleCanonical: string | null; userCanonical: string | null; crawledAs: string | null;
  sitemaps: string[]; referringUrls: string[];
  richResults: { verdict: string | null; items: { type: string; name: string; issues: { message: string; severity: string }[] }[] } | null;
}

export function parseInspection(json: Json): Inspection {
  const r = json.inspectionResult ?? {};
  const i = r.indexStatusResult ?? {};
  const rr = r.richResultsResult;
  return {
    link: r.inspectionResultLink ?? null, verdict: i.verdict ?? null, coverageState: i.coverageState ?? null,
    robotsTxtState: i.robotsTxtState ?? null, indexingState: i.indexingState ?? null, lastCrawlTime: i.lastCrawlTime ?? null,
    pageFetchState: i.pageFetchState ?? null, googleCanonical: i.googleCanonical ?? null, userCanonical: i.userCanonical ?? null,
    crawledAs: i.crawledAs ?? null, sitemaps: i.sitemap ?? [], referringUrls: (i.referringUrls ?? []).slice(0, 10),
    richResults: rr ? {
      verdict: rr.verdict ?? null,
      items: (rr.detectedItems ?? []).flatMap((d: Json) => (d.items ?? [{}]).map((it: Json) => ({
        type: d.richResultType, name: it.name ?? "", issues: (it.issues ?? []).map((x: Json) => ({ message: x.issueMessage, severity: x.severity })),
      }))),
    } : null,
  };
}

const crawlNote = (i: Inspection) =>
  `Google-indexed information from the URL Inspection API (not a live test).${i.lastCrawlTime ? ` Last crawled by Google ${i.lastCrawlTime}.` : " Google reports no crawl date."}`;

export function inspectionFindings(i: Inspection, url: string, fetchedAt: string): ProviderFinding[] {
  const base = { provider: "gsc" as const, url, providerTimestamp: fetchedAt, sourceRef: i.link ?? "https://search.google.com/search-console", evidence: crawlNote(i) };
  const out: ProviderFinding[] = [];
  if (i.verdict && i.verdict !== "PASS") {
    out.push({
      ...base, type: "indexing", kind: i.verdict === "FAIL" ? "confirmed" : "needs-review", severity: i.verdict === "FAIL" ? "high" : "medium", confidence: 0.85,
      rule: "gsc:coverage", metricKey: "gsc:coverage", title: "Google reports this page is not indexed",
      current: i.coverageState ?? i.verdict, proposed: "Indexed (if this page should appear in Google Search)",
      recommendation: "Check whether this page is meant to be indexed. If so, review content quality, internal links, canonical and robots settings, then request indexing in Search Console.",
    });
  }
  if (i.pageFetchState && i.pageFetchState !== "SUCCESSFUL") {
    out.push({ ...base, type: "indexing", kind: "confirmed", severity: "high", confidence: 0.85, rule: "gsc:fetch", metricKey: "gsc:fetch", title: "Google could not fetch this page", current: i.pageFetchState, proposed: "SUCCESSFUL", recommendation: "Fix the server/HTTP problem Google reports, then re-inspect the URL in Search Console." });
  }
  if (i.robotsTxtState === "DISALLOWED") {
    out.push({ ...base, type: "indexing", kind: "confirmed", severity: "high", confidence: 0.85, rule: "gsc:robots", metricKey: "gsc:robots", title: "Blocked by robots.txt for Google", current: "DISALLOWED", proposed: "ALLOWED", recommendation: "Remove the robots.txt rule blocking this page if it should be crawled." });
  }
  if (i.googleCanonical && i.userCanonical && i.googleCanonical !== i.userCanonical) {
    out.push({
      ...base, type: "indexing", kind: "needs-review", severity: "medium", confidence: 0.75, rule: "gsc:canonical", metricKey: "gsc:canonical",
      title: "Google chose a different canonical", current: `Google: ${i.googleCanonical} · declared: ${i.userCanonical}`, proposed: "Google-selected canonical matches the declared canonical",
      recommendation: "Check for duplicate pages, inconsistent internal links or redirects that make Google prefer another URL.",
    });
  }
  for (const item of i.richResults?.items ?? []) {
    const errors = item.issues.filter((x) => x.severity === "ERROR");
    if (!errors.length) continue;
    out.push({
      ...base, type: "structured-data", kind: "confirmed", severity: "high", confidence: 0.85, rule: `gsc:rich:${item.type}`, metricKey: `gsc:rich:${item.type}`,
      title: `${item.type} rich result has errors in Google's index`, current: errors.map((e) => e.message).join("; "), proposed: "No errors (re-test with the Rich Results Test)",
      recommendation: "Fix the structured data, confirm with Google's Rich Results Test, then request re-indexing.",
    });
  }
  return out;
}

export function sitemapFindings(sitemaps: SitemapInfo[], property: string, fetchedAt: string): ProviderFinding[] {
  return sitemaps.filter((s) => (s.errors ?? 0) > 0).map((s) => ({
    provider: "gsc", type: "search-console", kind: "confirmed", severity: "medium", confidence: 0.85,
    rule: "gsc:sitemap-errors", metricKey: `gsc:sitemap:${s.path}`, title: "Sitemap has errors in Search Console", url: s.path,
    current: `${s.errors} errors, ${s.warnings ?? 0} warnings`, proposed: "0 errors",
    recommendation: "Open the sitemap report in Search Console for the exact errors, fix the sitemap, then let Google re-fetch it.",
    evidence: `Search Console sitemap report for ${property}.${s.lastDownloaded ? ` Last downloaded by Google ${s.lastDownloaded}.` : ""}`,
    sourceRef: "https://search.google.com/search-console/sitemaps", providerTimestamp: fetchedAt,
  }));
}
