import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir, getDb } from "./db";

/**
 * Consistent online backup of the database (SQLite VACUUM INTO), safe while the app and worker run.
 * Screenshots and reports live in data/runs and data/exports; copy those folders separately.
 */
export function backupDatabase(destDir = join(dataDir(), "backups")): { file: string } {
  mkdirSync(destDir, { recursive: true });
  const file = join(destDir, `webaudit-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return { file };
}
