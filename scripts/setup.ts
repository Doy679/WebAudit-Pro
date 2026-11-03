// One-time local setup: creates .env.local with a random server secret and the data folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const envPath = ".env.local";
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const lines = [existing.trimEnd()];
const add = (key: string, value: string, comment: string) => {
  if (new RegExp(`^${key}=`, "m").test(existing)) return;
  lines.push(`# ${comment}`, `${key}=${value}`);
};

add("WEBAUDIT_SECRET", randomBytes(32).toString("base64url"), "Encrypts stored secrets (AI key). Keep private; changing it makes saved secrets unreadable.");
add("WEBAUDIT_DATA_DIR", "data", "Database, screenshots and reports. Never served publicly.");
add("WEBAUDIT_APP_URL", "http://localhost:3000", "Used for links inside Excel/JSON reports.");
add("WEBAUDIT_BROWSER_CHANNEL", "msedge", "Installed browser for PDF rendering (msedge or chrome); empty = Playwright Chromium.");
add("WEBAUDIT_MAX_STORAGE_GB", "20", "Audits stop starting when the data folder exceeds this size.");

writeFileSync(envPath, lines.filter(Boolean).join("\n") + "\n");
mkdirSync("data", { recursive: true });
console.log(`Setup complete: ${envPath} and data/ are ready. Next: npm run dev, then open http://localhost:3000 to create the admin account.`);
