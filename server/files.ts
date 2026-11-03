import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { runsDir } from "./db";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/**
 * Reads an evidence image from a run's directory. Only images, only inside data/runs/<runId>/,
 * so a crafted path can never reach other runs, the database or exports.
 */
export async function readEvidence(runId: string, relPath: string): Promise<{ body: Buffer; type: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const type = TYPES[extname(relPath).toLowerCase()];
  if (!type) return null;
  const root = resolve(runsDir(), runId) + sep;
  const full = resolve(root, relPath);
  if (!full.startsWith(root)) return null;
  const body = await readFile(full).catch(() => null);
  return body ? { body, type } : null;
}

export const evidenceUrl = (runId: string, path: string) => `/api/evidence/${runId}/${path.split("/").map(encodeURIComponent).join("/")}`;
