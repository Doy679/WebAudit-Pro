import { decryptSecret, deleteSetting, encryptSecret, getSetting, setSetting } from "../settings";

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

export function saveGoogleCredentials(input: { apiKey?: string; removeApiKey?: boolean; oauthClientId?: string; oauthClientSecret?: string; removeOauth?: boolean; cruxEnabled?: boolean }) {
  if (input.removeApiKey) { deleteSetting("google.apiKey"); setSetting("google.apiKeySavedAt", new Date().toISOString()); }
  else if (input.apiKey?.trim()) { setSetting("google.apiKey", encryptSecret(input.apiKey.trim())); setSetting("google.apiKeySavedAt", new Date().toISOString()); }
  if (input.removeOauth) {
    deleteSetting("google.oauthClientId");
    deleteSetting("google.oauthClientSecret");
  } else {
    if (input.oauthClientId?.trim()) {
      if (!/\.apps\.googleusercontent\.com$/.test(input.oauthClientId.trim())) throw new Error("The OAuth client ID should end with .apps.googleusercontent.com");
      setSetting("google.oauthClientId", input.oauthClientId.trim());
    }
    if (input.oauthClientSecret?.trim()) setSetting("google.oauthClientSecret", encryptSecret(input.oauthClientSecret.trim()));
  }
  if (input.cruxEnabled !== undefined) setSetting("google.cruxEnabled", input.cruxEnabled ? "1" : "0");
}
