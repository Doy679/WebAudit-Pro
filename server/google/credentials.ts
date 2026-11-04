// GQA-01/02: Google credential shapes, checked before saving and before any request, and secret redaction for
// anything that may be shown or stored. Messages never repeat the submitted value.

export type CredentialField = "apiKey" | "oauthClientId" | "oauthClientSecret";
/** What a value looks like: "empty", "malformed", or the credential type it appears to be. */
export type CredentialKind = "empty" | "malformed" | "api-key" | "oauth-secret" | "oauth-client-id";
export type CredentialCheck = { ok: true } | { ok: false; kind: CredentialKind; message: string };

const API_KEY = /^AIza[0-9A-Za-z_-]{35}$/;
const CLIENT_ID = /^[0-9]+-[0-9A-Za-z_-]+\.apps\.googleusercontent\.com$/;
const CREDENTIALS_PATH = "Google Cloud → APIs & Services → Credentials";

/** Conventional Google API key shape. A matching value is not proof that Google accepts it. */
export const isGoogleApiKey = (v: string | undefined | null) => !!v && API_KEY.test(v);

/** Which kind of credential a value appears to be (never returns the value). */
export function credentialKind(v: string | undefined | null): CredentialKind {
  const s = (v ?? "").trim();
  if (!s) return "empty";
  if (API_KEY.test(s)) return "api-key";
  if (/^GOCSPX-/.test(s)) return "oauth-secret";
  if (/\.apps\.googleusercontent\.com$/.test(s)) return "oauth-client-id";
  return "malformed";
}

const WRONG: Record<CredentialField, Partial<Record<CredentialKind, string>>> = {
  apiKey: {
    "oauth-secret": `This looks like an OAuth client secret, not a Google API key. Copy the correct credential from ${CREDENTIALS_PATH} → API keys.`,
    "oauth-client-id": `This looks like an OAuth client ID, not a Google API key. Copy the correct credential from ${CREDENTIALS_PATH} → API keys.`,
    malformed: `This isn't a Google API key (they start with AIza and are 39 characters, with no spaces). Copy it from ${CREDENTIALS_PATH} → API keys.`,
    empty: "Enter the Google API key.",
  },
  oauthClientId: {
    "oauth-secret": `This looks like an OAuth client secret, not an OAuth client ID. The client ID ends with .apps.googleusercontent.com (${CREDENTIALS_PATH} → OAuth 2.0 Client IDs).`,
    "api-key": `This looks like a Google API key, not an OAuth client ID. The client ID ends with .apps.googleusercontent.com (${CREDENTIALS_PATH} → OAuth 2.0 Client IDs).`,
    malformed: "The OAuth client ID should end with .apps.googleusercontent.com",
    empty: "Enter the OAuth client ID.",
  },
  oauthClientSecret: {
    "api-key": `This looks like a Google API key, not an OAuth client secret. Paste it in the API key field; the client secret is shown on the OAuth client in ${CREDENTIALS_PATH}.`,
    "oauth-client-id": `This looks like an OAuth client ID, not the client secret. Paste it in the OAuth client ID field; the client secret is shown on the OAuth client in ${CREDENTIALS_PATH}.`,
    malformed: "This doesn't look like an OAuth client secret (it should be one word with no spaces, usually starting with GOCSPX-).",
    empty: "Enter the OAuth client secret.",
  },
};

export function checkCredential(field: CredentialField, value: string | undefined | null): CredentialCheck {
  const s = (value ?? "").trim();
  const kind = credentialKind(s);
  const ok = field === "apiKey" ? kind === "api-key"
    : field === "oauthClientId" ? kind === "oauth-client-id" && CLIENT_ID.test(s)
    : kind === "oauth-secret" || (kind === "malformed" && /^[0-9A-Za-z_-]{16,}$/.test(s)); // older secrets have no GOCSPX- prefix
  if (ok) return { ok: true };
  const k: CredentialKind = field === "oauthClientId" && kind === "oauth-client-id" ? "malformed" : kind;
  return { ok: false, kind: k, message: WRONG[field][k] ?? WRONG[field].malformed! };
}

/** Removes API keys, OAuth client secrets, access/refresh tokens and secret URL parameters from text. */
export const redactSecrets = (s: string) => s
  .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key hidden]")
  .replace(/GOCSPX-[0-9A-Za-z_-]+/g, "[secret hidden]")
  .replace(/ya29\.[0-9A-Za-z._-]+/g, "[token hidden]")
  .replace(/\b1\/\/[0-9A-Za-z_-]{10,}/g, "[token hidden]")
  .replace(/([?&](?:key|access_token|refresh_token|client_secret)=)[^&\s"']+/gi, "$1[hidden]");

/** Google Cloud Console → Credentials, in the given project (number or ID) when known. */
export const cloudCredentialsUrl = (project?: string | null) =>
  `https://console.cloud.google.com/apis/credentials${project ? `?project=${encodeURIComponent(project)}` : ""}`;
