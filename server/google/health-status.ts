// NEW-01: one PageSpeed health status for every screen, derived only from stored results (never a live call).
// "Last success" is the newest fresh Google measurement: cache reuses copy Google's original timestamp, so a
// cache hit can't make a rejected key look healthy. Failures recorded before the key was last saved don't count.
import { get } from "../db";
import type { User } from "../auth";
import { can } from "../permissions";
import { getSetting } from "../settings";
import { googleStatus } from "./config";
import { INTEGRATION_KINDS } from "./psi";

export type PsiHealthState = "not-configured" | "untested" | "ok" | "failing";

export interface PsiHealth {
  state: PsiHealthState;
  label: string;
  detail: string;
  failureKind?: string;
  lastSuccess?: string | null;
  lastFailure?: string | null;
  /** Google's raw error text (key removed): admins only. */
  technical?: string;
  action?: { href: string; label: string };
}

const FAILURE_LABEL: Record<string, string> = {
  "key-rejected": "API key rejected",
  "api-disabled": "PageSpeed Insights API not enabled in Google Cloud",
  "key-restricted": "API key restrictions block this server",
  forbidden: "Google refused the request",
  quota: "quota or rate limit reached",
  transient: "PageSpeed temporarily unavailable",
  network: "couldn't reach Google",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Older versions stored every 400/403 as "config"; the message tells which it was. */
function kindOf(kind: string | null, error: string | null): string {
  if (kind && kind !== "config") return kind;
  return /api key was rejected|api key not valid|api key expired/i.test(error ?? "") ? "key-rejected" : "forbidden";
}

export function pageSpeedHealth(user: User): PsiHealth {
  const connections = "/google/connections";
  if (!googleStatus().apiKeyConfigured) {
    return { state: "not-configured", label: "PageSpeed not set up", detail: "An admin needs to add a Google API key in Google Connections. Audits still work without it.", action: { href: connections, label: "Open Google Connections" } };
  }
  const since = getSetting("google.apiKeySavedAt") ?? "";
  const legacy = (getSetting("google.apiKeyLastCheck") ?? "").replace(/^ok /, "");
  const success = get<{ at: string | null }>("SELECT MAX(fetched_at) AS at FROM psi_results WHERE status = 'ok' AND fetched_at > ?", since)?.at
    ?? (legacy > since ? legacy : null);
  const kinds = [...INTEGRATION_KINDS, "config"];
  const fail = get<{ at: string; kind: string | null; error: string | null; detail: string | null }>(
    `SELECT fetched_at AS at, error_kind AS kind, error, error_detail AS detail FROM psi_results
     WHERE status = 'error' AND fetched_at > ? AND error_kind IN (${kinds.map(() => "?").join(",")}) ORDER BY fetched_at DESC, rowid DESC LIMIT 1`, since, ...kinds);

  if (fail && (!success || fail.at > success)) {
    const kind = kindOf(fail.kind, fail.error);
    return {
      state: "failing", failureKind: kind, lastSuccess: success, lastFailure: fail.at,
      label: `PageSpeed: last live request failed: ${FAILURE_LABEL[kind] ?? "error"} (${when(fail.at)})`,
      detail: `${fail.error ?? "The last request to Google failed."} ${success ? `Last successful request: ${when(success)}.` : "No request has succeeded with this key yet."} Earlier results stay available with their original dates.`,
      technical: can(user, "settings:manage") ? fail.detail ?? undefined : undefined,
      action: { href: connections, label: "Check the key in Google Connections" },
    };
  }
  if (!success) {
    return { state: "untested", label: "PageSpeed: key saved, not tested yet", detail: "No PageSpeed request has been made with this key yet.", lastFailure: null, lastSuccess: null, action: { href: connections, label: "Test it in Google Connections" } };
  }
  return { state: "ok", label: `PageSpeed working (last live request ${when(success)})`, detail: "The last request to Google succeeded.", lastSuccess: success, lastFailure: fail?.at ?? null };
}
