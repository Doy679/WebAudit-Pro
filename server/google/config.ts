import { all, get, newId, now, run, tx } from "../db";
import type { User } from "../auth";
import { assertCan } from "../permissions";
import { decryptSecret, deleteSetting, encryptSecret, getSetting, setSetting } from "../settings";
import { checkCredential, type CredentialField } from "./credentials";

// Google credentials are entered by an admin in Google Connections and stored in app_settings
// (secrets AES-GCM encrypted). Environment variables are a fallback for server deployments.
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const secret = (key: string) => {
  const v = getSetting(key);
  return v ? decryptSecret(v) : undefined;
};

export function googleConfig() {
  const appUrl = (process.env.WEBAUDIT_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    apiKey: secret("google.apiKey") ?? process.env.GOOGLE_API_KEY,
    oauthClientId: getSetting("google.oauthClientId") ?? process.env.GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: secret("google.oauthClientSecret") ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: `${appUrl}/api/google/oauth/callback`,
    cruxEnabled: getSetting("google.cruxEnabled") === "1",
  };
}

export function googleStatus() {
  const c = googleConfig();
  return {
    apiKeyConfigured: !!c.apiKey,
    apiKeySource: getSetting("google.apiKey") ? "settings" : c.apiKey ? "environment" : null,
    oauthConfigured: !!(c.oauthClientId && c.oauthClientSecret),
    cruxEnabled: c.cruxEnabled && !!c.apiKey,
    redirectUri: c.redirectUri,
    lastApiCheck: getSetting("google.apiKeyLastCheck") ?? null,
  };
}

const SETTING: Record<CredentialField, string> = { apiKey: "google.apiKey", oauthClientId: "google.oauthClientId", oauthClientSecret: "google.oauthClientSecret" };

/**
 * Saves credentials after checking every submitted value (GQA-01): if any value has the wrong shape nothing is
 * changed, so a mis-pasted credential never replaces a stored one. Each change is recorded without its value (GQA-07).
 */
export function saveGoogleCredentials(input: { apiKey?: string; removeApiKey?: boolean; oauthClientId?: string; oauthClientSecret?: string; removeOauth?: boolean; cruxEnabled?: boolean }, by?: User) {
  const apiKey = input.removeApiKey ? "" : input.apiKey?.trim() ?? "";
  const oauthClientId = input.removeOauth ? "" : input.oauthClientId?.trim() ?? "";
  const oauthClientSecret = input.removeOauth ? "" : input.oauthClientSecret?.trim() ?? "";
  for (const [field, value] of [["apiKey", apiKey], ["oauthClientId", oauthClientId], ["oauthClientSecret", oauthClientSecret]] as const) {
    if (!value) continue;
    const c = checkCredential(field, value);
    if (!c.ok) throw new Error(c.message);
  }
  const changes: [CredentialField, "added" | "replaced" | "removed"][] = [];
  const set = (field: CredentialField, value: string, encrypted: boolean) => {
    changes.push([field, getSetting(SETTING[field]) ? "replaced" : "added"]);
    setSetting(SETTING[field], encrypted ? encryptSecret(value) : value);
  };
  const remove = (field: CredentialField) => {
    if (!getSetting(SETTING[field])) return;
    deleteSetting(SETTING[field]);
    changes.push([field, "removed"]);
  };
  tx(() => {
    if (input.removeApiKey) { remove("apiKey"); setSetting("google.apiKeySavedAt", now()); }
    else if (apiKey) { set("apiKey", apiKey, true); setSetting("google.apiKeySavedAt", now()); }
    if (input.removeOauth) { remove("oauthClientId"); remove("oauthClientSecret"); }
    else {
      if (oauthClientId) set("oauthClientId", oauthClientId, false);
      if (oauthClientSecret) set("oauthClientSecret", oauthClientSecret, true);
    }
    if (input.cruxEnabled !== undefined) setSetting("google.cruxEnabled", input.cruxEnabled ? "1" : "0");
    const at = now();
    for (const [credential, action] of changes) {
      run("INSERT INTO credential_events (id, credential, action, user_id, created_at) VALUES (?, ?, ?, ?, ?)", newId(), credential, action, by?.id ?? null, at);
    }
  });
}

export interface CredentialEvent { credential: CredentialField; action: "added" | "replaced" | "removed"; changed_by: string | null; created_at: string }

/** Recorded credential changes, newest first (admins only). Changes made before tracking existed aren't listed. */
export function credentialHistory(user: User, limit = 20): CredentialEvent[] {
  assertCan(user, "settings:manage");
  return all<CredentialEvent>(
    `SELECT e.credential, e.action, u.name AS changed_by, e.created_at FROM credential_events e LEFT JOIN users u ON u.id = e.user_id
     ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?`, limit);
}

export function lastCredentialChange(user: User, credential: CredentialField): CredentialEvent | undefined {
  assertCan(user, "settings:manage");
  return get<CredentialEvent>(
    `SELECT e.credential, e.action, u.name AS changed_by, e.created_at FROM credential_events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.credential = ? ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1`, credential);
}
