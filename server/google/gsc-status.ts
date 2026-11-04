// One Search Console status for every screen (BUG-02). Derived only from saved settings and the last recorded
// check, so showing it never calls Google. Order: not configured → OAuth client configured → account connected →
// API error (specific) → no property selected → ready.
import { get } from "../db";
import type { User } from "../auth";
import { can } from "../permissions";
import { googleStatus } from "./config";
import { projectGoogle } from "./service";

export type GscState = "not-configured" | "client-configured" | "connected" | "api-error" | "no-property" | "ready";

export interface GscStatus {
  state: GscState;
  /** Short status line, identical wherever it appears. */
  label: string;
  /** One plain sentence: what it means / what to do. */
  detail: string;
  action?: { href: string; label: string };
  errorKind?: string;
  property?: string;
  checkedAt?: string | null;
  /** Google's raw error text: admins only. */
  technical?: string;
}

const ERROR_LABEL: Record<string, string> = {
  "api-disabled": "Search Console API not enabled in Google Cloud",
  permission: "No access to the Search Console property",
  auth: "Google sign-in expired",
  quota: "Search Console quota reached",
  network: "Couldn't reach Google",
  transient: "Google Search Console temporarily unavailable",
  other: "Search Console check failed",
};

type Conn = { id: string; last_error: string | null; last_error_kind: string | null; last_error_detail: string | null; last_check_at: string | null };

export function searchConsoleStatus(user: User, projectId?: string): GscStatus {
  const connections = `/google/connections${projectId ? `?project=${projectId}` : ""}`;
  if (!googleStatus().oauthConfigured) {
    return {
      state: "not-configured", label: "Search Console not set up",
      detail: "An admin needs to add the Google OAuth client in Google Connections. Audits still work without it.",
      action: { href: connections, label: "Open Google Connections" },
    };
  }
  const pg = projectId ? projectGoogle(user, projectId) : null;
  const cols = "id, last_error, last_error_kind, last_error_detail, last_check_at";
  // The project's bound connection wins; otherwise the viewer's own connection.
  const conn = (pg?.connection_id && get<Conn>(`SELECT ${cols} FROM google_connections WHERE id = ? AND revoked_at IS NULL`, pg.connection_id))
    || get<Conn>(`SELECT ${cols} FROM google_connections WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`, user.id);
  if (!conn) {
    return {
      state: "client-configured", label: "Google account not connected",
      detail: "Connect a Google account that has access to this website in Search Console.",
      action: { href: connections, label: "Connect Google" },
    };
  }
  const admin = can(user, "settings:manage");
  if (conn.last_error_kind) {
    return {
      state: "api-error", label: ERROR_LABEL[conn.last_error_kind] ?? ERROR_LABEL.other,
      detail: conn.last_error ?? "The last Search Console check failed.",
      action: { href: connections, label: "Open Google Connections to retry" },
      errorKind: conn.last_error_kind, checkedAt: conn.last_check_at,
      technical: admin ? conn.last_error_detail ?? undefined : undefined,
    };
  }
  if (pg?.gsc_property && pg.connection_id) {
    return { state: "ready", label: `Search Console ready: ${pg.gsc_property}`, detail: "Search Console data can be fetched for this website.", property: pg.gsc_property, checkedAt: conn.last_check_at };
  }
  if (!pg || !conn.last_check_at) {
    return {
      state: "connected", label: "Google account connected",
      detail: projectId ? "Next: choose this website's Search Console property." : "Choose a Search Console property for each website.",
      action: { href: connections, label: "Choose property" }, checkedAt: conn.last_check_at,
    };
  }
  return {
    state: "no-property", label: "No Search Console property selected",
    detail: "Choose the Search Console property for this website. If none is listed, ask the property owner to add your Google account.",
    action: { href: connections, label: "Choose property" }, checkedAt: conn.last_check_at,
  };
}
