// Seeds PageSpeed monitoring targets from a verified URL inventory. Idempotent: rows are matched by project +
// label, existing rows are never updated, so later admin edits (selection, licensing) are kept. Only projects
// listed in KNOWN_INVENTORIES are seeded automatically; every other project keeps the old behaviour.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { inventoryFromCsv, type TargetSeed } from "./target-rules";

/** Capital Home Mortgage: homepage + 51 state/DC pages, verified 2026-11-04 (see the CSV's evidence column). */
export const KNOWN_INVENTORIES = [
  { projectId: "568a8045-37e2-4b2c-b9a6-45be10a63568", file: "config/pagespeed-targets/capitalhomemortgage.com.csv" },
];

export function seedTargetsInto(db: DatabaseSync, projectId: string, rows: TargetSeed[]): { inserted: number; skipped: number } {
  const ts = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pagespeed_targets (id, project_id, url, label, "group", state_code, licensing_status, verification_status,
       verification_note, verified_at, selected, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let inserted = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of rows) {
      const res = insert.run(randomUUID(), projectId, r.url, r.label, r.group, r.state_code, r.licensing_status, r.verification_status,
        r.verification_note, r.verified_at, r.selected ? 1 : 0, r.sort_order, ts, ts);
      inserted += Number(res.changes);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { inserted, skipped: rows.length - inserted };
}

/** Runs at start-up: seeds a known project once it exists. A missing inventory file is skipped, not an error. */
export function seedKnownTargets(db: DatabaseSync, root = process.cwd()) {
  for (const k of KNOWN_INVENTORIES) {
    if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(k.projectId)) continue;
    if (db.prepare("SELECT 1 FROM pagespeed_targets WHERE project_id = ? LIMIT 1").get(k.projectId)) continue;
    const file = join(root, k.file);
    if (!existsSync(file)) continue;
    seedTargetsInto(db, k.projectId, inventoryFromCsv(readFileSync(file, "utf8")));
  }
}
