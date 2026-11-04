// PageSpeed monitoring targets per project: listing, the saved selection, licensing (admin), the run plan,
// confirmed batched runs and their progress. Viewing, planning and saving never create a PageSpeed request.
import { all, get, newId, now, run, safeJson, tx } from "../db";
import type { User } from "../auth";
import { assertCan, assertProjectAccess, NotFoundError } from "../permissions";
import { pageSpeedHealth } from "./health-status";
import { latestPsiPerKey, projectGoogle, PSI_CACHE_MS, queuePsi, type PsiRow } from "./service";
import { batchSize, chunk, exclusionReason, isRunnable, isSelectable, type LicensingStatus, type TargetGroup, type VerificationStatus } from "./target-rules";
import type { Strategy } from "./types";

export interface Target {
  id: string; project_id: string; url: string | null; label: string; group: TargetGroup; state_code: string | null;
  licensing_status: LicensingStatus; verification_status: VerificationStatus; verification_note: string | null; verified_at: string | null;
  selected: boolean; sort_order: number; updated_at: string;
}

const COLS = `id, project_id, url, label, "group", state_code, licensing_status, verification_status, verification_note, verified_at, selected, sort_order, updated_at`;
const toTarget = (r: Record<string, unknown>) => ({ ...(r as unknown as Target), selected: !!r.selected });

export function listTargets(user: User, projectId: string): Target[] {
  assertProjectAccess(user, projectId);
  return all<Record<string, unknown>>(`SELECT ${COLS} FROM pagespeed_targets WHERE project_id = ? ORDER BY sort_order, label`, projectId).map(toTarget);
}

/** Projects without targets keep the old behaviour (start page + the latest audit's pages). Call after an access check. */
export const hasTargets = (projectId: string) => !!get("SELECT 1 FROM pagespeed_targets WHERE project_id = ? LIMIT 1", projectId);

/** Saves which targets are selected. Every id must be a selectable target of this project; the server is the gate. */
export function saveTargetSelection(user: User, projectId: string, ids: string[]): { selected: number } {
  assertCan(user, "project:edit");
  const list = listTargets(user, projectId);
  const byId = new Map(list.map((t) => [t.id, t]));
  const wanted = new Set(ids);
  for (const id of wanted) {
    const t = byId.get(id);
    if (!t) throw new Error("A target that doesn't belong to this website can't be selected.");
    if (!isSelectable(t)) throw new Error(`"${t.label}" can't be selected: ${exclusionReason(t)}.`);
  }
  const ts = now();
  tx(() => {
    for (const t of list) {
      const sel = wanted.has(t.id);
      if (sel !== t.selected) run("UPDATE pagespeed_targets SET selected = ?, updated_at = ?, updated_by = ? WHERE id = ?", sel ? 1 : 0, ts, user.id, t.id);
    }
  });
  return { selected: wanted.size };
}

/** Admin only: the owner-supplied licensing status. Anything other than eligible also removes it from the selection. */
export function setLicensingStatus(user: User, projectId: string, targetId: string, status: LicensingStatus) {
  assertCan(user, "settings:manage");
  const t = listTargets(user, projectId).find((x) => x.id === targetId);
  if (!t) throw new NotFoundError("Target not found.");
  if (!["eligible", "license_pending", "not_licensed"].includes(status)) throw new Error("Unknown licensing status.");
  if (status === "eligible" && !t.url) throw new Error(`${t.label} has no landing page, so it can't be measured.`);
  run("UPDATE pagespeed_targets SET licensing_status = ?, selected = CASE WHEN ? = 'eligible' THEN selected ELSE 0 END, updated_at = ?, updated_by = ? WHERE id = ?",
    status, status, now(), user.id, targetId);
}

/** Why live PageSpeed runs are blocked right now (from stored state only; never calls Google), or null. */
export function psiRunGate(user: User): string | null {
  const h = pageSpeedHealth(user);
  if (h.state === "not-configured") return "PageSpeed isn't set up: an admin needs to add the Google API key in Google Connections.";
  if (h.state === "invalid-format") return `${h.label.replace(/^PageSpeed: t/, "T")}. Fix it in Google Connections before running.`;
  if (h.state === "failing" && ["key-rejected", "api-disabled", "key-restricted", "forbidden", "invalid-format"].includes(h.failureKind ?? "")) {
    return `${h.label}. Fix the key in Google Connections (and test it once) before running.`;
  }
  return null;
}

export interface RunPlan {
  urls: string[]; devices: Strategy[]; batchSize: number; batches: string[][];
  totalRequests: number; cacheHits: number; alreadyQueued: number; freshRequests: number;
  blocked: string | null; inProgress: boolean;
}

const cleanDevices = (d: Strategy[]) => [...new Set(d)].filter((s): s is Strategy => s === "mobile" || s === "desktop");

/** What "Run selected PageSpeed checks" would do: URLs, batches, requests, likely cache hits. Read-only. */
export function planTargetRun(user: User, projectId: string, opts: { devices: Strategy[]; skipCache: boolean }): RunPlan {
  const targets = listTargets(user, projectId);
  if (!targets.length) throw new Error("This website has no monitoring targets.");
  const urls = targets.filter(isRunnable).map((t) => t.url!);
  const devices = cleanDevices(opts.devices);
  const size = batchSize(projectGoogle(user, projectId).psi_max_urls);
  const inFlight = new Set(all<{ k: string }>(
    `SELECT json_extract(payload_json, '$.url') || '|' || json_extract(payload_json, '$.strategy') AS k FROM google_tasks
     WHERE project_id = ? AND type = 'psi' AND status IN ('pending', 'running')`, projectId).map((r) => r.k));
  const cached = opts.skipCache ? new Set<string>() : new Set(all<{ k: string }>(
    "SELECT url || '|' || strategy AS k FROM psi_results WHERE project_id = ? AND status = 'ok' AND fetched_at > ?",
    projectId, new Date(Date.now() - PSI_CACHE_MS).toISOString()).map((r) => r.k));
  let alreadyQueued = 0, cacheHits = 0;
  for (const u of urls) for (const d of devices) {
    if (inFlight.has(`${u}|${d}`)) alreadyQueued++;
    else if (cached.has(`${u}|${d}`)) cacheHits++;
  }
  const totalRequests = urls.length * devices.length;
  return {
    urls, devices, batchSize: size, batches: chunk(urls, size), totalRequests, cacheHits, alreadyQueued,
    freshRequests: totalRequests - cacheHits - alreadyQueued, blocked: psiRunGate(user), inProgress: !!activeRun(projectId),
  };
}

const activeRun = (projectId: string) => get<{ id: string }>(
  `SELECT r.id FROM pagespeed_target_runs r WHERE r.project_id = ? AND EXISTS (SELECT 1 FROM google_tasks t WHERE t.project_id = r.project_id
     AND t.type = 'psi' AND t.status IN ('pending', 'running') AND json_extract(t.payload_json, '$.targetRun') = r.id) ORDER BY r.created_at DESC LIMIT 1`, projectId);

/**
 * Starts a confirmed run: the selected targets are queued batch by batch through queuePsi (same dedupe, 6-hour cache
 * and per-project URL limit). The confirmation must restate the current request count, so a stale dialog can't start
 * a different run.
 */
export function startTargetRun(user: User, projectId: string, opts: { devices: Strategy[]; skipCache: boolean; confirmed: boolean; expectedRequests: number }) {
  assertCan(user, "audit:start");
  if (!opts.confirmed) throw new Error("Confirm the run first: it sends PageSpeed requests to Google.");
  const plan = planTargetRun(user, projectId, opts);
  if (plan.blocked) throw new Error(plan.blocked);
  if (!plan.urls.length || !plan.devices.length) throw new Error("Select at least one page and one device.");
  if (plan.totalRequests !== opts.expectedRequests) throw new Error("The selection changed since you reviewed it. Check the numbers and confirm again.");
  if (plan.inProgress) throw new Error("A PageSpeed run for this website is already in progress. Wait for it to finish.");

  const id = newId();
  const cachedPairs: { url: string; strategy: Strategy; batch: number }[] = [];
  const since = new Date(Date.now() - PSI_CACHE_MS).toISOString();
  if (!opts.skipCache) {
    const fresh = new Set(all<{ k: string }>("SELECT url || '|' || strategy AS k FROM psi_results WHERE project_id = ? AND status = 'ok' AND fetched_at > ?", projectId, since).map((r) => r.k));
    plan.batches.forEach((b, i) => b.forEach((url) => plan.devices.forEach((strategy) => { if (fresh.has(`${url}|${strategy}`)) cachedPairs.push({ url, strategy, batch: i + 1 }); })));
  }
  run(`INSERT INTO pagespeed_target_runs (id, project_id, devices, urls, batches, requests, cache_hits, skip_cache, cached_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, projectId, plan.devices.join(","), plan.urls.length, plan.batches.length, plan.totalRequests,
    plan.cacheHits, opts.skipCache ? 1 : 0, JSON.stringify(cachedPairs), user.id, now());
  let queued = 0, alreadyQueued = 0, recentlyMeasured = 0;
  plan.batches.forEach((urls, i) => {
    const r = queuePsi(user, projectId, { urls, strategies: plan.devices, force: opts.skipCache, tag: { targetRun: id, batch: i + 1 } });
    queued += r.queued.length; alreadyQueued += r.alreadyQueued; recentlyMeasured += r.recentlyMeasured;
  });
  return { runId: id, batches: plan.batches.length, queued, alreadyQueued, recentlyMeasured };
}

export type ItemState = "queued" | "cached" | "running" | "done" | "failed";
export interface RunProgress {
  id: string; created_at: string; devices: string; urls: number; requests: number; skipCache: boolean;
  batches: { number: number; urls: number; queued: number; running: number; done: number; cached: number; failed: number }[];
  items: { url: string; strategy: string; batch: number; state: ItemState; message: string | null }[];
  finished: boolean;
}

/** Progress of the latest confirmed run: per batch and per URL + device. */
export function targetRunProgress(user: User, projectId: string): RunProgress | null {
  assertProjectAccess(user, projectId);
  const r = get<{ id: string; created_at: string; devices: string; urls: number; requests: number; skip_cache: number; cached_json: string }>(
    "SELECT * FROM pagespeed_target_runs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", projectId);
  if (!r) return null;
  const tasks = all<{ status: string; outcome: string | null; error: string | null; url: string; strategy: string; batch: number }>(
    `SELECT status, outcome, error, json_extract(payload_json, '$.url') AS url, json_extract(payload_json, '$.strategy') AS strategy,
       json_extract(payload_json, '$.batch') AS batch FROM google_tasks WHERE project_id = ? AND type = 'psi' AND json_extract(payload_json, '$.targetRun') = ?`, projectId, r.id);
  const items: RunProgress["items"] = [
    ...tasks.map((t) => ({
      url: t.url, strategy: t.strategy, batch: Number(t.batch), message: t.status === "failed" ? t.error : null,
      state: (t.status === "pending" ? "queued" : t.status === "running" ? "running" : t.status === "failed" ? "failed" : t.outcome === "cached" ? "cached" : "done") as ItemState,
    })),
    ...safeJson<{ url: string; strategy: string; batch: number }[]>(r.cached_json, []).map((c) => ({ ...c, state: "cached" as ItemState, message: "Reused a Google result under 6 hours old" })),
  ].sort((a, b) => a.batch - b.batch || a.url.localeCompare(b.url) || a.strategy.localeCompare(b.strategy));
  const nums = [...new Set(items.map((i) => i.batch))].sort((a, b) => a - b);
  const batches = nums.map((n) => {
    const b = items.filter((i) => i.batch === n);
    const count = (s: ItemState) => b.filter((i) => i.state === s).length;
    return { number: n, urls: new Set(b.map((i) => i.url)).size, queued: count("queued"), running: count("running"), done: count("done"), cached: count("cached"), failed: count("failed") };
  });
  return {
    id: r.id, created_at: r.created_at, devices: r.devices, urls: r.urls, requests: r.requests, skipCache: !!r.skip_cache, batches, items,
    finished: !items.some((i) => i.state === "queued" || i.state === "running"),
  };
}

export interface MonitoredRow { target: Target; url: string; mobile: PsiRow | null; desktop: PsiRow | null }

/**
 * Results for the monitored targets (latest result per device, or null: "Not measured yet"), and the latest results
 * of every other URL measured before (historical / unmonitored). Results are read by URL; nothing is remapped.
 */
export function monitoredResults(user: User, projectId: string): { monitored: MonitoredRow[]; unmonitored: PsiRow[] } {
  const latest = latestPsiPerKey(user, projectId);
  const byKey = new Map(latest.map((r) => [`${r.url}|${r.strategy}`, r]));
  const monitored = listTargets(user, projectId).filter(isRunnable).map((t) => ({
    target: t, url: t.url!, mobile: byKey.get(`${t.url}|mobile`) ?? null, desktop: byKey.get(`${t.url}|desktop`) ?? null,
  }));
  const urls = new Set(monitored.map((m) => m.url));
  return { monitored, unmonitored: latest.filter((r) => !urls.has(r.url)) };
}

/** Read-only inputs for the targets panel: what is cached or queued per URL + device, and whether runs are blocked. */
export function targetPanelState(user: User, projectId: string) {
  assertProjectAccess(user, projectId);
  const since = new Date(Date.now() - PSI_CACHE_MS).toISOString();
  return {
    projectLimit: projectGoogle(user, projectId).psi_max_urls,
    cachedKeys: all<{ k: string }>("SELECT DISTINCT url || '|' || strategy AS k FROM psi_results WHERE project_id = ? AND status = 'ok' AND fetched_at > ?", projectId, since).map((r) => r.k),
    inFlightKeys: all<{ k: string }>(`SELECT json_extract(payload_json, '$.url') || '|' || json_extract(payload_json, '$.strategy') AS k FROM google_tasks
      WHERE project_id = ? AND type = 'psi' AND status IN ('pending', 'running')`, projectId).map((r) => r.k),
    blocked: psiRunGate(user),
    inProgress: !!activeRun(projectId),
  };
}
