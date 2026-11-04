// G3: the guided Google setup checklist on Google Connections. Five steps derived only from stored settings and
// the last recorded checks, so showing it never calls Google.
import type { User } from "../auth";
import { googleConfig, googleStatus } from "./config";
import { credentialKind, isGoogleApiKey } from "./credentials";
import { CREDENTIALS_ANCHOR, pageSpeedHealth } from "./health-status";
import { searchConsoleStatus } from "./gsc-status";
import { listConnections, projectGoogle } from "./service";

export type StepState = "done" | "todo" | "problem" | "unverified";

export interface SetupStep {
  id: "key-saved" | "key-format" | "account" | "gsc-api" | "property";
  title: string;
  state: StepState;
  /** Current state in plain words. */
  status: string;
  checkedAt?: string | null;
  why: string;
  next?: { label: string; href: string };
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function setupChecklist(user: User, projectId?: string): SetupStep[] {
  const status = googleStatus();
  const health = pageSpeedHealth(user);
  const key = googleConfig().apiKey;
  const looksLike = credentialKind(key);
  const gsc = searchConsoleStatus(user, projectId);
  const connection = listConnections(user)[0];
  const pg = projectId ? projectGoogle(user, projectId) : null;
  const connectionsHref = `/google/connections${projectId ? `?project=${projectId}` : ""}`;
  const retry = { label: "Retry / Test connection (one request)", href: `${connectionsHref}#search-console-retry` };

  const keySaved: SetupStep = {
    id: "key-saved", title: "PageSpeed API key saved",
    state: status.apiKeyConfigured ? "done" : "todo",
    status: status.apiKeyConfigured ? `Saved (${status.apiKeySource})` : "No key saved",
    why: "PageSpeed scores and Google's real-user speed data need a Google API key. Audits work without it.",
    next: status.apiKeyConfigured ? undefined : { label: "Add the API key", href: CREDENTIALS_ANCHOR },
  };

  const keyFormat: SetupStep = !status.apiKeyConfigured
    ? { id: "key-format", title: "PageSpeed credential format valid", state: "todo", status: "Waiting for a saved key", why: "A Google API key starts with AIza and is 39 characters long." }
    : !isGoogleApiKey(key)
      ? {
        id: "key-format", title: "PageSpeed credential format valid", state: "problem",
        status: `The saved value isn't a Google API key${looksLike === "oauth-secret" ? ": it looks like an OAuth client secret" : looksLike === "oauth-client-id" ? ": it looks like an OAuth client ID" : ""}. No PageSpeed requests are sent.`,
        why: "Google only accepts an API key here. OAuth client IDs and secrets are different credentials used for Search Console sign-in.",
        next: { label: "Replace it with the API key", href: CREDENTIALS_ANCHOR },
      }
      : {
        id: "key-format", title: "PageSpeed credential format valid",
        state: health.state === "ok" ? "done" : health.state === "failing" ? "problem" : "unverified",
        status: health.state === "ok" ? `Valid format, and Google accepted it (${health.label.replace(/^PageSpeed working \(|\)$/g, "")})`
          : health.state === "failing" ? `Valid format, but ${health.label.replace(/^PageSpeed: /, "")}`
          : "Valid format. A correct format doesn't prove Google accepts the key: test it once.",
        checkedAt: health.lastFailure && health.state === "failing" ? health.lastFailure : health.lastSuccess ?? null,
        why: "A key in the right format can still be rejected by Google (deleted, restricted or from another project).",
        next: health.state === "ok" ? undefined : { label: "Test PageSpeed key (one request)", href: `${connectionsHref}#pagespeed-test` },
      };

  const account: SetupStep = {
    id: "account", title: "Google account connected",
    state: connection ? "done" : "todo",
    status: !status.oauthConfigured ? "The OAuth client isn't set up yet" : connection ? `Connected ${when(connection.created_at)}` : "Not connected",
    why: "Search Console data is read with a Google account that has access to the website's property (read-only).",
    next: connection ? undefined : status.oauthConfigured ? { label: "Connect Google", href: "/api/google/oauth/start" } : { label: "Add the OAuth client", href: CREDENTIALS_ANCHOR },
  };

  const gscApi: SetupStep = !connection
    ? { id: "gsc-api", title: "Search Console API status verified", state: "todo", status: "Waiting for a connected Google account", why: "The Google Search Console API must be enabled in the same Google Cloud project as the OAuth client." }
    : {
      id: "gsc-api", title: "Search Console API status verified",
      state: !gsc.checkedAt ? "unverified" : gsc.state === "api-error" ? "problem" : gsc.stale ? "unverified" : "done",
      status: !gsc.checkedAt ? "Not checked yet"
        : gsc.state === "api-error" ? `${gsc.label}${gsc.stale ? " (may be out of date)" : ""}`
        : `Reachable${gsc.lastSuccessAt ? ` (last success ${when(gsc.lastSuccessAt)})` : ""}${gsc.stale ? ": may be out of date" : ""}`,
      checkedAt: gsc.checkedAt ?? null,
      why: "The Google Search Console API must be enabled in the same Google Cloud project as the OAuth client. WebAudit Pro only re-checks when an admin presses Retry.",
      next: gsc.checkedAt && !gsc.stale && gsc.state !== "api-error" ? undefined : retry,
    };

  const property: SetupStep = {
    id: "property", title: "Search Console property selected",
    state: pg?.gsc_property && pg.connection_id ? "done" : "todo",
    status: pg?.gsc_property ? `${pg.gsc_property}${pg.connection_id ? "" : " (connection removed: select again)"}` : projectId ? "None selected for this website" : "Choose a website first",
    why: "Each website reads Search Console data from the property you choose; WebAudit Pro checks your account has access to it.",
    next: pg?.gsc_property && pg.connection_id ? undefined : { label: "Choose the property", href: `${connectionsHref}#search-console-property` },
  };

  return [keySaved, keyFormat, account, gscApi, property];
}
