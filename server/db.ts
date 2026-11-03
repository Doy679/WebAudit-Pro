import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Loaded at runtime so bundlers never try to resolve the prefix-only "node:sqlite" builtin.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

export type DB = DatabaseSyncType;
type Row = Record<string, unknown>;

export const dataDir = () => resolve(process.env.WEBAUDIT_DATA_DIR ?? "data");
export const runsDir = () => join(dataDir(), "runs");
export const exportsDir = () => join(dataDir(), "exports");
export const newId = () => randomUUID();
export const now = () => new Date().toISOString();

// Schema kept PostgreSQL-compatible: TEXT ids, ISO-8601 TEXT timestamps, INTEGER flags, JSON in TEXT.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','pm','qa','developer','client')),
  disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, domain TEXT NOT NULL,
  authorized_by TEXT NOT NULL REFERENCES users(id), authorized_at TEXT NOT NULL, authorization_note TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}', tokens_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
  start_url TEXT NOT NULL, settings_json TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, heartbeat_at TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0, phase TEXT, error TEXT,
  pages_total INTEGER NOT NULL DEFAULT 0, pages_done INTEGER NOT NULL DEFAULT 0, pages_failed INTEGER NOT NULL DEFAULT 0,
  pages_skipped INTEGER NOT NULL DEFAULT 0, findings_raw INTEGER NOT NULL DEFAULT 0, findings INTEGER NOT NULL DEFAULT 0,
  current_url TEXT, current_viewport INTEGER, run_dir TEXT, summary_json TEXT
);
CREATE TABLE IF NOT EXISTS run_pages (
  run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE, url TEXT NOT NULL,
  ok INTEGER NOT NULL, status INTEGER NOT NULL, error TEXT, PRIMARY KEY (run_id, url)
);
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL, fingerprint TEXT NOT NULL, type TEXT NOT NULL, rule TEXT NOT NULL, kind TEXT NOT NULL,
  severity TEXT NOT NULL, confidence REAL NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
  pages_json TEXT NOT NULL, viewports_json TEXT NOT NULL, selector TEXT, elementor_id TEXT,
  shared_template INTEGER NOT NULL DEFAULT 0, instance_count INTEGER NOT NULL DEFAULT 1,
  current_value TEXT, proposed_value TEXT, recommendation TEXT NOT NULL, evidence_json TEXT NOT NULL,
  occurrences_json TEXT NOT NULL, captured_at TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','confirmed','false_positive')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','revision_requested','rejected')),
  implementation_status TEXT NOT NULL DEFAULT 'todo' CHECK (implementation_status IN ('todo','in_progress','done','wont_fix')),
  priority TEXT, assignee_id TEXT REFERENCES users(id), notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
  UNIQUE (run_id, code)
);
CREATE INDEX IF NOT EXISTS issues_run ON issues(run_id);
CREATE INDEX IF NOT EXISTS issues_project_fp ON issues(project_id, fingerprint);
CREATE TABLE IF NOT EXISTS issue_events (
  id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id),
  actor_label TEXT NOT NULL, action TEXT NOT NULL, from_value TEXT, to_value TEXT, note TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issue_events_issue ON issue_events(issue_id);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('audit','export')), ref_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('xlsx','pdf','html','json')), filters_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  file_path TEXT, file_name TEXT, size_bytes INTEGER, issue_count INTEGER, error TEXT,
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS approval_packages (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE, title TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked_at TEXT, revoked_by TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, submitted_at TEXT
);
CREATE TABLE IF NOT EXISTS approval_items (
  package_id TEXT NOT NULL REFERENCES approval_packages(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, PRIMARY KEY (package_id, issue_id)
);
CREATE TABLE IF NOT EXISTS client_decisions (
  id TEXT PRIMARY KEY, package_id TEXT NOT NULL REFERENCES approval_packages(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','revision_requested')),
  comment TEXT NOT NULL DEFAULT '', client_name TEXT NOT NULL, client_email TEXT NOT NULL,
  ip TEXT, user_agent TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const globalForDb = globalThis as unknown as { __webauditDb?: { path: string; db: DB } };

/** Opens (and migrates) the database. One connection per process; reused across Next.js hot reloads. */
export function getDb(): DB {
  const path = join(dataDir(), "webaudit.db");
  if (globalForDb.__webauditDb?.path === path) return globalForDb.__webauditDb.db;
  mkdirSync(dataDir(), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  globalForDb.__webauditDb = { path, db };
  return db;
}

/** Closes the cached connection (tests switch data dirs). */
export function closeDb() {
  globalForDb.__webauditDb?.db.close();
  globalForDb.__webauditDb = undefined;
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}
export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}
export function run(sql: string, ...params: unknown[]) {
  return getDb().prepare(sql).run(...(params as never[]));
}

/** Runs fn in a transaction (BEGIN IMMEDIATE so concurrent writers wait instead of failing). */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
