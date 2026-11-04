import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../server/auth";

const dir = mkdtempSync(join(tmpdir(), "webaudit-account-"));
process.env.WEBAUDIT_DATA_DIR = dir;

const { closeDb, get } = await import("../server/db");
const auth = await import("../server/auth");
const perms = await import("../server/permissions");
const { backupDatabase } = await import("../server/backup");

let admin: User, qa: User;
beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  qa = auth.createUser({ email: "qa@example.com", name: "QA", password: "temporary password 1", role: "qa" });
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("change password", () => {
  it("requires the current password and the minimum length", () => {
    expect(() => auth.changePassword(qa, "wrong password!!", "a brand new password")).toThrow(/current password/i);
    expect(() => auth.changePassword(qa, "temporary password 1", "short")).toThrow(/at least 10/);
  });

  it("changes the password and signs out every other session", () => {
    const other = auth.createSession(qa.id);
    const current = auth.createSession(qa.id);
    auth.changePassword(qa, "temporary password 1", "a brand new password", current);
    expect(auth.authenticate("qa@example.com", "temporary password 1")).toBeNull();
    expect(auth.authenticate("qa@example.com", "a brand new password")?.id).toBe(qa.id);
    expect(auth.sessionUser(other)).toBeNull();
    expect(auth.sessionUser(current)?.id).toBe(qa.id);
  });
});

describe("admin password reset", () => {
  it("is admin-only and signs the user out everywhere", () => {
    const s = auth.createSession(qa.id);
    expect(() => auth.resetPassword(qa, admin.id, "another long password")).toThrow(perms.ForbiddenError);
    auth.resetPassword(admin, qa.id, "reset by admin 2026");
    expect(auth.sessionUser(s)).toBeNull();
    expect(auth.authenticate("qa@example.com", "reset by admin 2026")?.id).toBe(qa.id);
  });
});

describe("database backup", () => {
  it("writes a consistent, openable copy without touching the live database", () => {
    const { file } = backupDatabase(join(dir, "backups"));
    expect(existsSync(file)).toBe(true);
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const copy = new DatabaseSync(file, { readOnly: true });
    expect((copy.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(get<{ n: number }>("SELECT COUNT(*) AS n FROM users")!.n);
    expect((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    copy.close();
  });
});

describe("UX-19: admins change roles safely", () => {
  it("changes another user's role and signs them out; refuses self-demotion and non-admins", async () => {
    const { createUser, createSession, sessionUser, setUserRole } = await import("../server/auth");
    const { get } = await import("../server/db");
    const boss = get<any>("SELECT id, email, name, role FROM users WHERE role = 'admin' LIMIT 1");
    const dev = createUser({ email: `dev${Date.now()}@example.com`, name: "Dev", password: "correct horse battery", role: "developer" });
    const token = createSession(dev.id);
    setUserRole(boss, dev.id, "qa");
    expect(get<{ role: string }>("SELECT role FROM users WHERE id = ?", dev.id)!.role).toBe("qa");
    expect(sessionUser(token)).toBeNull(); // new permissions apply at next sign-in
    expect(() => setUserRole(boss, boss.id, "qa")).toThrow(/your own role/i);
    expect(() => setUserRole({ ...dev, role: "qa" }, boss.id, "client")).toThrow(/only admins/i);
    expect(() => setUserRole(boss, dev.id, "superuser" as never)).toThrow(/role/i);
  });
});
