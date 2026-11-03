// Creates an admin account from the command line (alternative to the first-run /setup page).
// Usage: npm run create-admin -- --email you@agency.com --name "Your Name" --password "a long password"
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { createUser } = await import("../server/auth");

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, password: { type: "string" } } });
if (!values.email || !values.name || !values.password) {
  console.error('Usage: npm run create-admin -- --email you@agency.com --name "Your Name" --password "at least 10 characters"');
  process.exit(1);
}
try {
  const user = createUser({ email: values.email, name: values.name, password: values.password, role: "admin" });
  console.log(`Admin created: ${user.email}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
