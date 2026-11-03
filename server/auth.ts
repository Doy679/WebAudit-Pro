import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { all, get, run, newId, now } from "./db";

export type Role = "admin" | "pm" | "qa" | "developer" | "client";
export const ROLES: Role[] = ["admin", "pm", "qa", "developer", "client"];
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin", pm: "Project Manager", qa: "QA Reviewer", developer: "Developer", client: "Client",
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const SESSION_DAYS = 7;
const MIN_PASSWORD = 10;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

export function createUser(input: { email: string; name: string; password: string; role: Role }): User {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!input.name.trim()) throw new Error("Enter a name.");
  if (input.password.length < MIN_PASSWORD) throw new Error(`Passwords must be at least ${MIN_PASSWORD} characters.`);
  if (!ROLES.includes(input.role)) throw new Error("Unknown role.");
  if (get("SELECT 1 FROM users WHERE email = ?", email)) throw new Error("A user with that email already exists.");
  const user: User = { id: newId(), email, name: input.name.trim(), role: input.role };
  run("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    user.id, user.email, user.name, hashPassword(input.password), user.role, now());
  return user;
}

export function authenticate(email: string, password: string): User | null {
  const row = get<User & { password_hash: string; disabled: number }>(
    "SELECT id, email, name, role, password_hash, disabled FROM users WHERE email = ?", email.trim().toLowerCase());
  // Verify against a dummy hash when the user is unknown so timing does not reveal which emails exist.
  const ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || row.disabled) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));

/** Returns the raw session token (for the cookie). Only its SHA-256 is stored. */
export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  run("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", sha256(token), userId, expires, now());
  return token;
}

export function sessionUser(token: string | undefined): User | null {
  if (!token) return null;
  const row = get<User & { expires_at: string; disabled: number }>(
    `SELECT u.id, u.email, u.name, u.role, u.disabled, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    sha256(token));
  if (!row || row.disabled || row.expires_at < now()) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function destroySession(token: string | undefined) {
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
}

export const userCount = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM users")!.n;

export function listUsers(): (User & { disabled: number; created_at: string })[] {
  return all("SELECT id, email, name, role, disabled, created_at FROM users ORDER BY created_at");
}

export function setUserDisabled(userId: string, disabled: boolean) {
  run("UPDATE users SET disabled = ? WHERE id = ?", disabled ? 1 : 0, userId);
  if (disabled) run("DELETE FROM sessions WHERE user_id = ?", userId);
}
