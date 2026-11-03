import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { get, run } from "./db";

// Secrets in app_settings (e.g. the optional AI API key) are encrypted with AES-256-GCM.
// The key comes from WEBAUDIT_SECRET (set in .env.local by `npm run setup`).
function key(): Buffer {
  const secret = process.env.WEBAUDIT_SECRET;
  if (!secret || secret.length < 32) throw new Error("WEBAUDIT_SECRET is not set (run `npm run setup`).");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1") throw new Error("Unknown secret format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export const getSetting = (k: string) => get<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", k)?.value;
export const setSetting = (k: string, v: string) =>
  run("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, v);
export const deleteSetting = (k: string) => run("DELETE FROM app_settings WHERE key = ?", k);

export interface AiSettings {
  enabled: boolean;
  model: string;
  hasKey: boolean;
}

export const DEFAULT_AI_MODEL = "claude-opus-5-5";

export function aiSettings(): AiSettings {
  return {
    enabled: getSetting("ai.enabled") === "1",
    model: getSetting("ai.model") || DEFAULT_AI_MODEL,
    hasKey: !!getSetting("ai.key"),
  };
}

export function aiKey(): string | null {
  const stored = getSetting("ai.key");
  return stored ? decryptSecret(stored) : null;
}
