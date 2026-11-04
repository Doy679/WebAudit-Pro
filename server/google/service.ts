// Google SEO & Performance services: connections, property binding, request queue, storage and findings.
// External calls run in the worker (processGoogleTask); the web app only queues requests and reads stored results.
import { createHash, randomBytes } from "node:crypto";
import { all, get, run, newId, now, tx } from "../db";
import type { User } from "../auth";
import { assertCan, assertProjectAccess, ForbiddenError, NotFoundError, projectScope } from "../permissions";
import { getProject, isInScope } from "../projects";
import { decryptSecret, encryptSecret } from "../settings";
import { googleConfig } from "./config";
import { runPsi, psiFindings, psiReportUrl, PsiConfigError, PsiPageError, PsiQuotaError } from "./psi";
import { queryCrux } from "./crux";
import {
  authUrl, pkcePair, exchangeCode, refreshAccess, revokeToken, listSites, searchAnalytics, listSitemaps, inspectUrl,
  parseInspection, inspectionFindings, sitemapFindings, propertyCoversUrl, propertyMatchesDomain,
  GscAuthError, GscError, GscQuotaError, type SiteEntry, type AnalyticsRow,
} from "./gsc";
import type { FieldData, ProviderFinding, PsiResult, Strategy } from "./types";

let googleFetch: typeof fetch = (...args) => fetch(...args);
/** Tests replace the network layer; production uses global fetch. */
export function setGoogleFetch(f: typeof fetch) { googleFetch = f; }

const PSI_CACHE_MS = 6 * 3_600_000;
const GSC_CACHE_MS = 6 * 3_600_000;
const INSPECTION_DAILY_LIMIT = 2000; // Google's per-property URL Inspection quota
const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

// ── Project settings ───────────────────────────────────────────────────────────────

export interface ProjectGoogle {
  project_id: string; connection_id: string | null; gsc_property: string | null; gsc_permission: string | null;
  psi_max_urls: number; inspection_max_urls: number; connection_owner: string | null; connection_revoked: string | null; connection_error: string | null;
}

export function projectGoogle(user: User, projectId: string): ProjectGoogle {
  assertProjectAccess(user, projectId);
  run("INSERT OR IGNORE INTO project_google (project_id, updated_at) VALUES (?, ?)", projectId, now());
  return get<ProjectGoogle>(
    `SELECT pg.*, u.name AS connection_owner, c.revoked_at AS connection_revoked, c.last_error AS connection_error
     FROM project_google pg LEFT JOIN google_connections c ON c.id = pg.connection_id LEFT JOIN users u ON u.id = c.user_id
     WHERE pg.project_id = ?`, projectId)!;
}

export function setProjectLimits(user: User, projectId: string, limits: { psiMaxUrls: number; inspectionMaxUrls: number }) {
  assertCan(user, "project:edit");
  projectGoogle(user, projectId);
  const psi = Math.min(Math.max(Math.floor(limits.psiMaxUrls), 1), 50);
  const insp = Math.min(Math.max(Math.floor(limits.inspectionMaxUrls), 1), 200);
  run("UPDATE project_google SET psi_max_urls = ?, inspection_max_urls = ?, updated_by = ?, updated_at = ? WHERE project_id = ?", psi, insp, user.id, now(), projectId);
}

// ── OAuth connections (one per app user) ─────────────────────────────────────────────

export interface Connection { id: string; user_id: string; owner: string; scopes: string; created_at: string; revoked_at: string | null; last_error: string | null }

export function listConnections(user: User): Connection[] {
  return all<Connection>(
    `SELECT c.id, c.user_id, u.name AS owner, c.scopes, c.created_at, c.revoked_at, c.last_error FROM google_connections c JOIN users u ON u.id = c.user_id
     WHERE c.user_id = ? AND c.revoked_at IS NULL ORDER BY c.created_at DESC`, user.id);
}

export function startOAuth(user: User) {
  assertCan(user, "dashboard:view");
  const cfg = googleConfig();
  if (!cfg.oauthClientId || !cfg.oauthClientSecret) throw new Error("Google OAuth is not configured. An admin must add the OAuth client ID and secret in Google Connections.");
  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const cookie = encryptSecret(JSON.stringify({ state, verifier, userId: user.id, exp: Date.now() + 10 * 60_000 }));
  return { url: authUrl({ clientId: cfg.oauthClientId, redirectUri: cfg.redirectUri, state, challenge }), cookie };
}

export async function completeOAuth(user: User, p: { code: string; state: string; cookie: string | undefined }) {
  let pending: { state: string; verifier: string; userId: string; exp: number };
  try {
    pending = JSON.parse(decryptSecret(p.cookie ?? ""));
  } catch {
    throw new Error("The Google sign-in session expired or is invalid. Start the connection again.");
  }
  if (pending.userId !== user.id || pending.exp < Date.now() || pending.state !== p.state) {
    throw new Error("Google sign-in state did not match. Start the connection again.");
  }
  const cfg = googleConfig();
  const t = await exchangeCode({ code: p.code, verifier: pending.verifier, clientId: cfg.oauthClientId!, clientSecret: cfg.oauthClientSecret!, redirectUri: cfg.redirectUri }, googleFetch);
  const id = newId();
  run(`INSERT INTO google_connections (id, user_id, scopes, refresh_token_enc, access_token_enc, access_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, user.id, t.scope, encryptSecret(t.refreshToken), encryptSecret(t.accessToken), t.expiresAt, now());
  return { id };
}

async function accessToken(connectionId: string): Promise<string> {
  const c = get<{ refresh_token_enc: string; access_token_enc: string | null; access_expires_at: string | null; revoked_at: string | null }>(
    "SELECT refresh_token_enc, access_token_enc, access_expires_at, revoked_at FROM google_connections WHERE id = ?", connectionId);
  if (!c || c.revoked_at || !c.refresh_token_enc) throw new GscAuthError("This Google connection was disconnected. Connect Google again.");
  if (c.access_token_enc && c.access_expires_at && Date.parse(c.access_expires_at) > Date.now() + 60_000) return decryptSecret(c.access_token_enc);
  const cfg = googleConfig();
  if (!cfg.oauthClientId || !cfg.oauthClientSecret) throw new GscAuthError("Google OAuth is no longer configured.");
  try {
    const t = await refreshAccess({ refreshToken: decryptSecret(c.refresh_token_enc), clientId: cfg.oauthClientId, clientSecret: cfg.oauthClientSecret }, googleFetch);
    run(`UPDATE google_connections SET access_token_enc = ?, access_expires_at = ?,
           last_error = CASE WHEN last_error_kind IS NULL OR last_error_kind = 'auth' THEN NULL ELSE last_error END,
           last_error_detail = CASE WHEN last_error_kind IS NULL OR last_error_kind = 'auth' THEN NULL ELSE last_error_detail END,
           last_error_kind = CASE WHEN last_error_kind = 'auth' THEN NULL ELSE last_error_kind END WHERE id = ?`,
      encryptSecret(t.accessToken), t.expiresAt, connectionId);
    return t.accessToken;
  } catch (e) {
    if (e instanceof GscAuthError) run("UPDATE google_connections SET last_error = ?, last_error_kind = 'auth', last_check_at = ? WHERE id = ?", e.message, now(), connectionId);
    throw e;
  }
}

function ownedConnection(user: User, connectionId: string) {
  const c = get<{ user_id: string; revoked_at: string | null }>("SELECT user_id, revoked_at FROM google_connections WHERE id = ?", connectionId);
  if (!c || c.revoked_at) throw new NotFoundError("Google connection not found.");
  if (c.user_id !== user.id) throw new ForbiddenError("You can only use your own Google connection.");
}

const sitesCache = new Map<string, { at: number; sites: SiteEntry[] }>();
// A failed check is remembered briefly so page views don't call Google again on every load; Retry bypasses it.
const failedCache = new Map<string, { at: number; error: Error }>();
export async function listProperties(user: User, connectionId: string): Promise<SiteEntry[]> {
  ownedConnection(user, connectionId);
  const hit = sitesCache.get(connectionId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.sites;
  const failed = failedCache.get(connectionId);
  if (failed && Date.now() - failed.at < 2 * 60_000) throw failed.error;
  try {
    const sites = await listSites(await accessToken(connectionId), googleFetch);
    sitesCache.set(connectionId, { at: Date.now(), sites });
    failedCache.delete(connectionId);
    run("UPDATE google_connections SET last_error = NULL, last_error_kind = NULL, last_error_detail = NULL, last_check_at = ? WHERE id = ?", now(), connectionId);
    return sites;
  } catch (e) {
    const err = e as GscError;
    failedCache.set(connectionId, { at: Date.now(), error: err });
    run("UPDATE google_connections SET last_error = ?, last_error_kind = ?, last_error_detail = ?, last_check_at = ? WHERE id = ?",
      err.message, err.kind ?? "other", err.technical ?? null, now(), connectionId);
    throw e;
  }
}

/** Retry / Test connection: one read-only sites.list call, bypassing caches. Never exposes tokens. */
export async function testSearchConsole(user: User, connectionId: string, projectId?: string):
  Promise<{ ok: true; properties: number } | { ok: false; kind: string; message: string }> {
  ownedConnection(user, connectionId);
  sitesCache.delete(connectionId);
  failedCache.delete(connectionId);
  try {
    const sites = await listProperties(user, connectionId);
    const domain = projectId ? getProject(user, projectId).domain : null;
    return { ok: true, properties: domain ? sites.filter((s) => propertyMatchesDomain(s.siteUrl, domain)).length : sites.length };
  } catch (e) {
    return { ok: false, kind: (e as GscError).kind ?? "other", message: (e as Error).message };
  }
}

export async function bindProperty(user: User, projectId: string, connectionId: string, property: string) {
  assertCan(user, "project:edit");
  const project = getProject(user, projectId);
  ownedConnection(user, connectionId);
  if (!propertyMatchesDomain(property, project.domain)) throw new Error(`${property} doesn't match this project's domain (${project.domain}).`);
  sitesCache.delete(connectionId);
  const site = (await listProperties(user, connectionId)).find((s) => s.siteUrl === property);
  if (!site || site.permissionLevel === "siteUnverifiedUser") {
    throw new ForbiddenError(`Access required: your Google account has no verified access to ${property} in Search Console. Ask the property owner to add you.`);
  }
  projectGoogle(user, projectId);
  run("UPDATE project_google SET connection_id = ?, gsc_property = ?, gsc_permission = ?, updated_by = ?, updated_at = ? WHERE project_id = ?",
    connectionId, property, site.permissionLevel, user.id, now(), projectId);
}

export async function disconnect(user: User, connectionId: string) {
  ownedConnection(user, connectionId);
  const c = get<{ refresh_token_enc: string }>("SELECT refresh_token_enc FROM google_connections WHERE id = ?", connectionId)!;
  let revoked = true;
  try {
    await revokeToken(decryptSecret(c.refresh_token_enc), googleFetch);
  } catch {
    revoked = false; // tokens are still deleted locally
  }
  tx(() => {
    run("UPDATE google_connections SET revoked_at = ?, refresh_token_enc = '', access_token_enc = NULL, access_expires_at = NULL, last_error = ? WHERE id = ?",
      now(), revoked ? null : "Google could not be reached to revoke the token; local tokens were deleted. You can also remove access at myaccount.google.com/permissions.", connectionId);
    run("UPDATE project_google SET connection_id = NULL, gsc_permission = NULL, updated_at = ? WHERE connection_id = ?", now(), connectionId);
  });
  sitesCache.delete(connectionId);
}

// ── Request queue ────────────────────────────────────────────────────────────────────

type TaskType = "psi" | "gsc_performance" | "gsc_sitemaps" | "gsc_inspect";
function queue(user: User, type: TaskType, projectId: string, runId: string | undefined, payload: unknown): string {
  const id = newId();
  run(`INSERT INTO google_tasks (id, type, project_id, run_id, payload_json, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id, type, projectId, runId ?? null, JSON.stringify(payload), user.id, now());
  return id;
}

function checkRun(projectId: string, runId?: string) {
  if (runId && !get("SELECT 1 FROM audit_runs WHERE id = ? AND project_id = ?", runId, projectId)) throw new NotFoundError("Audit run not found in this project.");
}

export function queuePsi(user: User, projectId: string, p: { urls: string[]; strategies: Strategy[]; runId?: string; force?: boolean }): string[] {
  assertCan(user, "audit:start");
  const project = getProject(user, projectId);
  if (!googleConfig().apiKey) throw new Error("PageSpeed Insights needs a Google API key. An admin can add it in Google Connections.");
  const urls = [...new Set(p.urls.map((u) => u.trim()).filter(Boolean))];
  if (!urls.length) throw new Error("Choose at least one URL.");
  const outside = urls.filter((u) => !/^https?:\/\//i.test(u) || !isInScope(project, u));
  if (outside.length) throw new Error(`These URLs are outside the project's domain (${project.domain}): ${outside.slice(0, 3).join(", ")}`);
  const strategies = [...new Set(p.strategies)].filter((s) => s === "mobile" || s === "desktop");
  if (!strategies.length) throw new Error("Choose mobile, desktop or both.");
  const limit = projectGoogle(user, projectId).psi_max_urls;
  if (urls.length > limit) throw new Error(`PageSpeed requests are limited to at most ${limit} URLs per run for this project (change it in the project's Google settings).`);
  checkRun(projectId, p.runId);
  return urls.flatMap((url) => strategies.map((strategy) => queue(user, "psi", projectId, p.runId, { url, strategy, force: !!p.force })));
}

function boundProperty(user: User, projectId: string) {
  const pg = projectGoogle(user, projectId);
  if (!pg.gsc_property || !pg.connection_id || pg.connection_revoked) throw new Error("Connect Google Search Console and select a property for this project first.");
  return pg;
}

export interface DateRange { startDate: string; endDate: string }

export function queueGsc(user: User, projectId: string, p: { kind: "performance"; range: DateRange; runId?: string } | { kind: "sitemaps"; runId?: string } | { kind: "inspection"; urls: string[]; runId?: string }): string[] {
  assertCan(user, "audit:start");
  const project = getProject(user, projectId);
  const pg = boundProperty(user, projectId);
  checkRun(projectId, p.runId);
  if (p.kind === "performance") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.range.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(p.range.endDate) || p.range.startDate > p.range.endDate) throw new Error("Choose a valid date range.");
    return [queue(user, "gsc_performance", projectId, p.runId, { range: p.range })];
  }
  if (p.kind === "sitemaps") return [queue(user, "gsc_sitemaps", projectId, p.runId, {})];
  const urls = [...new Set(p.urls.map((u) => u.trim()).filter(Boolean))];
  const outside = urls.filter((u) => !isInScope(project, u) || !propertyCoversUrl(pg.gsc_property!, u));
  if (outside.length) throw new Error(`These URLs are outside the project or its Search Console property: ${outside.slice(0, 3).join(", ")}`);
  if (urls.length > pg.inspection_max_urls) throw new Error(`URL inspection is limited to at most ${pg.inspection_max_urls} URLs per request for this project.`);
  const today = get<{ n: number }>("SELECT COUNT(*) AS n FROM gsc_data WHERE property = ? AND kind = 'inspection' AND fetched_at >= ?", pg.gsc_property, new Date().toISOString().slice(0, 10))!.n;
  if (today + urls.length > INSPECTION_DAILY_LIMIT) throw new Error(`Google allows ${INSPECTION_DAILY_LIMIT} inspections per property per day; ${today} have been used today.`);
  return urls.map((url) => queue(user, "gsc_inspect", projectId, p.runId, { url }));
}

// ── Worker side ───────────────────────────────────────────────────────────────────────

export function claimGoogleTask(): string | undefined {
  return tx(() => {
    const t = get<{ id: string }>("SELECT id FROM google_tasks WHERE status = 'pending' ORDER BY created_at LIMIT 1");
    if (t) run("UPDATE google_tasks SET status = 'running', started_at = ? WHERE id = ?", now(), t.id);
    return t?.id;
  });
}

const errorKind = (e: unknown) =>
  e instanceof PsiQuotaError || e instanceof GscQuotaError ? "quota" : e instanceof PsiConfigError ? "config" : e instanceof PsiPageError ? "page"
    : e instanceof GscError ? e.kind : "transient";

/** Runs one queued Google request. Provider failures are stored as error rows (never as invented data). */
export async function processGoogleTask(taskId: string): Promise<"completed" | "failed"> {
  const t = get<{ id: string; type: TaskType; project_id: string; run_id: string | null; payload_json: string; created_by: string }>("SELECT * FROM google_tasks WHERE id = ?", taskId);
  if (!t) return "failed";
  run("UPDATE google_tasks SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?", now(), taskId);
  const payload = JSON.parse(t.payload_json);
  let error: string | null = null;
  try {
    if (t.type === "psi") await doPsi(t, payload);
    else await doGsc(t, t.type, payload);
  } catch (e) {
    error = (e as Error).message;
  }
  run("UPDATE google_tasks SET status = ?, error = ?, finished_at = ? WHERE id = ?", error ? "failed" : "completed", error, now(), taskId);
  return error ? "failed" : "completed";
}

type Task = { id: string; project_id: string; run_id: string | null; created_by: string };

async function doPsi(t: Task, p: { url: string; strategy: Strategy; force: boolean }) {
  if (!p.force) {
    const cached = get<{ id: string; fetched_at: string; analysis_ts: string; lighthouse_version: string; result_json: string; crux_json: string | null }>(
      "SELECT * FROM psi_results WHERE project_id = ? AND url = ? AND strategy = ? AND status = 'ok' ORDER BY fetched_at DESC LIMIT 1", t.project_id, p.url, p.strategy);
    if (cached && Date.now() - Date.parse(cached.fetched_at) < PSI_CACHE_MS) {
      // Reuse Google's earlier result (original timestamps kept) instead of spending quota.
      run(`INSERT INTO psi_results (id, project_id, run_id, url, strategy, status, fetched_at, analysis_ts, lighthouse_version, result_json, crux_json, created_by)
           VALUES (?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?, ?)`, newId(), t.project_id, t.run_id, p.url, p.strategy, cached.fetched_at, cached.analysis_ts, cached.lighthouse_version, cached.result_json, cached.crux_json, t.created_by);
      if (t.run_id) importProviderFindings(t.run_id, psiFindings(JSON.parse(cached.result_json), p.url));
      return;
    }
  }
  const cfg = googleConfig();
  try {
    const result = await runPsi(p.url, p.strategy, { apiKey: cfg.apiKey!, fetchImpl: googleFetch });
    let crux: FieldData | null = null;
    if (cfg.cruxEnabled) crux = await queryCrux(p.url, p.strategy, cfg.apiKey!, googleFetch).catch(() => null);
    run(`INSERT INTO psi_results (id, project_id, run_id, url, strategy, status, fetched_at, analysis_ts, lighthouse_version, result_json, crux_json, created_by)
         VALUES (?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?, ?)`, newId(), t.project_id, t.run_id, p.url, p.strategy, now(), result.analysisTimestamp, result.lighthouseVersion, JSON.stringify(result), crux ? JSON.stringify(crux) : null, t.created_by);
    run("INSERT INTO app_settings (key, value) VALUES ('google.apiKeyLastCheck', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `ok ${now()}`);
    if (t.run_id) importProviderFindings(t.run_id, psiFindings(result, p.url));
  } catch (e) {
    run(`INSERT INTO psi_results (id, project_id, run_id, url, strategy, status, error, error_kind, fetched_at, created_by) VALUES (?, ?, ?, ?, ?, 'error', ?, ?, ?, ?)`,
      newId(), t.project_id, t.run_id, p.url, p.strategy, (e as Error).message, errorKind(e), now(), t.created_by);
    throw e;
  }
}

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export function previousRange(r: DateRange): DateRange {
  const len = Math.round((Date.parse(r.endDate) - Date.parse(r.startDate)) / 86_400_000) + 1;
  return { startDate: shift(r.startDate, -len), endDate: shift(r.startDate, -1) };
}

async function doGsc(t: Task, type: Exclude<TaskType, "psi">, p: Record<string, unknown>) {
  const pg = get<{ connection_id: string | null; gsc_property: string | null }>("SELECT connection_id, gsc_property FROM project_google WHERE project_id = ?", t.project_id);
  const property = pg?.gsc_property;
  const store = (kind: "performance" | "sitemaps" | "inspection", key: string, params: unknown, data: unknown, error?: string) =>
    run(`INSERT INTO gsc_data (id, project_id, run_id, property, kind, key, params_json, data_json, status, error, fetched_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), t.project_id, t.run_id, property ?? "", kind, key, JSON.stringify(params ?? {}), data === null ? null : JSON.stringify(data), error ? "error" : "ok", error ?? null, now(), t.created_by);
  const kind = type === "gsc_performance" ? "performance" : type === "gsc_sitemaps" ? "sitemaps" : "inspection";
  const key = kind === "inspection" ? String(p.url) : kind === "performance" ? `${(p.range as DateRange).startDate}_${(p.range as DateRange).endDate}` : "all";

  if (!pg?.connection_id || !property) {
    const msg = "Search Console is not connected for this project.";
    store(kind, key, p, null, msg);
    throw new Error(msg);
  }
  try {
    const token = await accessToken(pg.connection_id);
    if (kind === "performance") {
      const range = p.range as DateRange;
      const cached = get<{ fetched_at: string }>("SELECT fetched_at FROM gsc_data WHERE project_id = ? AND kind = 'performance' AND key = ? AND property = ? AND status = 'ok' ORDER BY fetched_at DESC LIMIT 1", t.project_id, key, property);
      if (cached && Date.now() - Date.parse(cached.fetched_at) < GSC_CACHE_MS && !t.run_id) return;
      const prev = previousRange(range);
      const q = (r: DateRange, dimensions?: ("query" | "page" | "device" | "date" | "searchAppearance")[], rowLimit = 25) =>
        searchAnalytics(token, property, { ...r, dimensions, rowLimit, dataState: "final" }, googleFetch);
      const sum = (rows: AnalyticsRow[]) => rows[0] ? { clicks: rows[0].clicks, impressions: rows[0].impressions, ctr: rows[0].ctr, position: rows[0].position } : { clicks: 0, impressions: 0, ctr: 0, position: null };
      const [totals, byDate, pages, queries, devices, appearance, prevTotals, prevByDate] = await Promise.all([
        q(range), q(range, ["date"], 500), q(range, ["page"]), q(range, ["query"]), q(range, ["device"]), q(range, ["searchAppearance"]),
        q(prev), q(prev, ["date"], 500),
      ]);
      store("performance", key, { range, dataState: "final" }, {
        range, totals: sum(totals), byDate, pages, queries, devices, appearance,
        previous: { range: prev, totals: sum(prevTotals), byDate: prevByDate },
        notes: "Final Search Console data only (the most recent 2–3 days are usually still being processed). Top lists are limited to 25 rows; Google may omit anonymized queries.",
      });
    } else if (kind === "sitemaps") {
      const sitemaps = await listSitemaps(token, property, googleFetch);
      store("sitemaps", key, {}, { sitemaps });
      if (t.run_id) importProviderFindings(t.run_id, sitemapFindings(sitemaps, property, now()));
    } else {
      const url = String(p.url);
      const raw = await inspectUrl(token, property, url, googleFetch);
      const parsed = parseInspection(raw);
      store("inspection", url, { url }, parsed);
      if (t.run_id) importProviderFindings(t.run_id, inspectionFindings(parsed, url, now()));
    }
  } catch (e) {
    store(kind, key, p, null, (e as Error).message);
    // Account-level problems found by a background request feed the shared status (BUG-02).
    const err = e as GscError;
    if (err instanceof GscError && ["api-disabled", "auth", "permission"].includes(err.kind)) {
      run("UPDATE google_connections SET last_error = ?, last_error_kind = ?, last_error_detail = ?, last_check_at = ? WHERE id = ?",
        err.message, err.kind, err.technical ?? null, now(), pg.connection_id);
    }
    throw e;
  }
}

// ── Findings import (dedupe by fingerprint within a run) ───────────────────────────────

const PREFIX: Record<ProviderFinding["type"], string> = { performance: "PERF", cwv: "CWV", "structured-data": "SD", indexing: "IDX", "search-console": "GSC", seo: "SEO" };

export function providerFingerprint(f: ProviderFinding) {
  let path = f.url;
  try { const u = new URL(f.url); path = u.pathname + u.search; } catch { /* keep raw */ }
  return sha(`${f.rule}|${f.strategy ?? ""}|${path}`);
}

/** Inserts provider findings into an audit run; a finding already present (same fingerprint) is updated, keeping its review state. */
export function importProviderFindings(runId: string, findings: ProviderFinding[]) {
  const r = get<{ project_id: string }>("SELECT project_id FROM audit_runs WHERE id = ?", runId);
  if (!r) return;
  const ts = now();
  tx(() => {
    for (const f of findings) {
      const fp = providerFingerprint(f);
      const evidence = { screenshots: [], boxes: [], computedCss: { provider: f.provider, metricKey: f.metricKey, strategy: f.strategy ?? null, evidence: f.evidence }, capturedAt: f.providerTimestamp };
      const existing = get<{ id: string }>("SELECT id FROM issues WHERE run_id = ? AND fingerprint = ?", runId, fp);
      if (existing) {
        run(`UPDATE issues SET current_value = ?, proposed_value = ?, recommendation = ?, evidence_json = ?, severity = ?, confidence = ?, provider_ts = ?, source_ref = ?, updated_at = ? WHERE id = ?`,
          f.current, f.proposed, f.recommendation, JSON.stringify(evidence), f.severity, f.confidence, f.providerTimestamp, f.sourceRef, ts, existing.id);
        continue;
      }
      const prefix = PREFIX[f.type];
      const n = get<{ n: number }>("SELECT COALESCE(MAX(CAST(SUBSTR(code, ?) AS INTEGER)), 0) AS n FROM issues WHERE run_id = ? AND code LIKE ?", prefix.length + 2, runId, `${prefix}-%`)!.n + 1;
      run(`INSERT INTO issues (id, run_id, project_id, code, fingerprint, type, rule, kind, severity, confidence, title, url, pages_json, viewports_json,
             selector, shared_template, instance_count, current_value, proposed_value, recommendation, evidence_json, occurrences_json, captured_at,
             updated_at, provider, source_ref, provider_ts, metric_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 0, 1, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)`,
        newId(), runId, r.project_id, `${prefix}-${String(n).padStart(4, "0")}`, fp, f.type, f.rule, f.kind, f.severity, f.confidence, f.title, f.url,
        JSON.stringify([f.url]), f.strategy ? `${f.strategy} (Lighthouse)` : null, f.current, f.proposed, f.recommendation, JSON.stringify(evidence),
        f.providerTimestamp, ts, f.provider, f.sourceRef, f.providerTimestamp, f.metricKey);
    }
    run("UPDATE audit_runs SET findings = (SELECT COUNT(*) FROM issues WHERE run_id = ?) WHERE id = ?", runId, runId);
  });
}

// ── Reads for the UI and reports ─────────────────────────────────────────────────────

export interface PsiRow {
  id: string; url: string; strategy: Strategy; status: "ok" | "error"; error: string | null; error_kind: string | null; run_id: string | null;
  fetched_at: string; analysis_ts: string | null; lighthouse_version: string | null; result: PsiResult | null; crux: FieldData | null; reportUrl: string;
}
const toPsi = (r: Record<string, unknown>): PsiRow => ({
  ...(r as unknown as PsiRow),
  result: r.result_json ? JSON.parse(r.result_json as string) : null,
  crux: r.crux_json ? JSON.parse(r.crux_json as string) : null,
  reportUrl: psiReportUrl(r.url as string, r.strategy as Strategy),
});

export function latestPsi(user: User, projectId: string, url: string, strategy: Strategy): PsiRow | undefined {
  assertProjectAccess(user, projectId);
  const r = get<Record<string, unknown>>("SELECT * FROM psi_results WHERE project_id = ? AND url = ? AND strategy = ? ORDER BY fetched_at DESC, rowid DESC LIMIT 1", projectId, url, strategy);
  return r ? toPsi(r) : undefined;
}

/**
 * The current PageSpeed result for every URL + device of a project: the newest completed result
 * (ties on fetched_at broken by insertion order), or the newest failure if that URL never succeeded.
 * Shared by every screen that shows "latest" PageSpeed values (BUG-03).
 */
export function latestPsiPerKey(user: User, projectId: string): PsiRow[] {
  assertProjectAccess(user, projectId);
  return all<Record<string, unknown>>(
    `SELECT p.* FROM psi_results p
     WHERE p.project_id = ? AND p.rowid = (
       SELECT x.rowid FROM psi_results x WHERE x.project_id = p.project_id AND x.url = p.url AND x.strategy = p.strategy
       ORDER BY (x.status = 'ok') DESC, x.fetched_at DESC, x.rowid DESC LIMIT 1)
     ORDER BY p.url, p.strategy`, projectId).map(toPsi);
}

export function psiResults(user: User, opts: { projectId?: string; runId?: string; url?: string; strategy?: Strategy; limit?: number }): (PsiRow & { project_name: string })[] {
  const scope = projectScope(user, "p.project_id");
  const where = [scope.sql];
  const params: unknown[] = [...scope.params];
  if (opts.projectId) { where.push("p.project_id = ?"); params.push(opts.projectId); }
  if (opts.runId) { where.push("p.run_id = ?"); params.push(opts.runId); }
  if (opts.url) { where.push("p.url = ?"); params.push(opts.url); }
  if (opts.strategy) { where.push("p.strategy = ?"); params.push(opts.strategy); }
  return all<Record<string, unknown>>(`SELECT p.*, pr.name AS project_name FROM psi_results p JOIN projects pr ON pr.id = p.project_id WHERE ${where.join(" AND ")} ORDER BY p.fetched_at DESC, p.rowid DESC LIMIT ?`, ...params, opts.limit ?? 200)
    .map((r) => ({ ...toPsi(r), project_name: r.project_name as string }));
}

export interface GscRow { id: string; run_id: string | null; property: string; kind: string; key: string; status: "ok" | "error"; error: string | null; fetched_at: string; data: any } // eslint-disable-line @typescript-eslint/no-explicit-any
const toGsc = (r: Record<string, unknown>): GscRow => ({ ...(r as unknown as GscRow), data: r.data_json ? JSON.parse(r.data_json as string) : null });

export function latestGsc(user: User, projectId: string, kind: "performance" | "sitemaps", opts: { runId?: string; key?: string } = {}): GscRow | undefined {
  assertProjectAccess(user, projectId);
  const r = get<Record<string, unknown>>(
    `SELECT * FROM gsc_data WHERE project_id = ? AND kind = ? ${opts.runId ? "AND run_id = ?" : ""} ${opts.key ? "AND key = ?" : ""} ORDER BY fetched_at DESC, rowid DESC LIMIT 1`,
    projectId, kind, ...(opts.runId ? [opts.runId] : []), ...(opts.key ? [opts.key] : []));
  return r ? toGsc(r) : undefined;
}

export function gscHistory(user: User, projectId: string, kind: "performance" | "sitemaps" | "inspection", limit = 50): GscRow[] {
  assertProjectAccess(user, projectId);
  return all<Record<string, unknown>>("SELECT * FROM gsc_data WHERE project_id = ? AND kind = ? ORDER BY fetched_at DESC, rowid DESC LIMIT ?", projectId, kind, limit).map(toGsc);
}

/** Latest inspection per URL (optionally for one run). */
export function inspections(user: User, projectId: string, runId?: string): GscRow[] {
  assertProjectAccess(user, projectId);
  return all<Record<string, unknown>>(
    `SELECT g.* FROM gsc_data g WHERE g.project_id = ? AND g.kind = 'inspection' ${runId ? "AND g.run_id = ?" : ""}
     AND g.rowid = (SELECT x.rowid FROM gsc_data x WHERE x.project_id = g.project_id AND x.kind = 'inspection' AND x.key = g.key ${runId ? "AND x.run_id = g.run_id" : ""} ORDER BY x.fetched_at DESC, x.rowid DESC LIMIT 1)
     ORDER BY g.key`, projectId, ...(runId ? [runId] : [])).map(toGsc);
}

export function structuredData(user: User, runId: string) {
  const r = get<{ project_id: string }>("SELECT project_id FROM audit_runs WHERE id = ?", runId);
  if (!r) throw new NotFoundError("Audit run not found.");
  assertProjectAccess(user, r.project_id);
  return all<{ url: string; items_json: string; errors: number; warnings: number; rules_version: string; checked_at: string }>(
    "SELECT url, items_json, errors, warnings, rules_version, checked_at FROM structured_data WHERE run_id = ? ORDER BY errors DESC, url", runId,
  ).map((x) => ({ ...x, items: JSON.parse(x.items_json) as import("../../src/schema/types").SdItem[] }));
}

export function googleTasks(user: User, projectId?: string, limit = 50) {
  const scope = projectScope(user, "t.project_id");
  return all<{ id: string; type: string; status: string; error: string | null; payload_json: string; created_at: string; finished_at: string | null; project_name: string; run_id: string | null }>(
    `SELECT t.*, p.name AS project_name FROM google_tasks t JOIN projects p ON p.id = t.project_id WHERE ${scope.sql} ${projectId ? "AND t.project_id = ?" : ""} ORDER BY t.created_at DESC LIMIT ?`,
    ...scope.params, ...(projectId ? [projectId] : []), limit);
}

/** Last N complete days of final Search Console data (Google usually lags 2–3 days). */
export function presetRange(days: number, today = new Date()): DateRange {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 3));
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
