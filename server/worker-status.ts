// Worker liveness, from a heartbeat the worker writes on its own timer (independent of the job loop),
// so a long audit phase never makes a healthy worker look dead, and an old row never looks "online".
import { hostname } from "node:os";
import { get, run, newId, now } from "./db";

export type WorkerState = "online" | "starting" | "stale" | "offline" | "unhealthy";

const staleMs = () => Number(process.env.WEBAUDIT_WORKER_STALE_MS ?? 30_000);
const stallMs = () => Number(process.env.WEBAUDIT_RUN_STALL_MS ?? 10 * 60_000);

function ensureTable() {
  run(`CREATE TABLE IF NOT EXISTS worker_heartbeats (
    id TEXT PRIMARY KEY, pid INTEGER NOT NULL, host TEXT NOT NULL, status TEXT NOT NULL,
    started_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, current_run TEXT
  )`);
}

type Row = { id: string; pid: number; host: string; status: string; started_at: string; heartbeat_at: string; current_run: string | null };
const latest = () => {
  ensureTable();
  return get<Row>("SELECT * FROM worker_heartbeats WHERE status != 'stopped' ORDER BY heartbeat_at DESC LIMIT 1");
};
const fresh = (r: Row) => Date.now() - Date.parse(r.heartbeat_at) <= staleMs();

/** Registers this process as the worker. Refuses to start when another worker is alive (prevents double processing). */
export function registerWorker(): string {
  const other = latest();
  if (other && fresh(other)) {
    throw new Error(`Another WebAudit Pro worker is already running (pid ${other.pid} on ${other.host}). Stop it first, or keep using it.`);
  }
  // Old rows from crashed workers are closed so they can never be mistaken for a live worker.
  run("UPDATE worker_heartbeats SET status = 'stopped' WHERE status != 'stopped'");
  const id = newId();
  run("INSERT INTO worker_heartbeats (id, pid, host, status, started_at, heartbeat_at) VALUES (?, ?, ?, 'starting', ?, ?)", id, process.pid, hostname(), now(), now());
  return id;
}

export function beat(id: string, status: "starting" | "online", currentRun?: string | null) {
  run("UPDATE worker_heartbeats SET status = ?, heartbeat_at = ?, current_run = ? WHERE id = ?", status, now(), currentRun ?? null, id);
}

export function stopWorker(id: string) {
  run("UPDATE worker_heartbeats SET status = 'stopped', heartbeat_at = ?, current_run = NULL WHERE id = ?", now(), id);
}

export interface WorkerStatus { state: WorkerState; label: string; detail: string; lastHeartbeat: string | null; pid: number | null; currentRun: string | null }

export function workerStatus(): WorkerStatus {
  const r = latest();
  if (!r) return { state: "offline", label: "Worker offline", detail: "The audit worker isn't running. Start the app with `npm start` (web and worker together). Your queued audits are kept and start automatically.", lastHeartbeat: null, pid: null, currentRun: null };
  const base = { lastHeartbeat: r.heartbeat_at, pid: r.pid, currentRun: r.current_run };
  if (!fresh(r)) return { ...base, state: "stale", label: "No recent heartbeat", detail: `The worker last reported ${Math.round((Date.now() - Date.parse(r.heartbeat_at)) / 1000)} s ago. It has probably stopped; restart the app with \`npm start\`. Queued audits are kept.` };
  if (r.status === "starting") return { ...base, state: "starting", label: "Worker starting", detail: "The worker is starting and recovering queued audits." };
  if (r.current_run) {
    const a = get<{ heartbeat_at: string | null; status: string }>("SELECT heartbeat_at, status FROM audit_runs WHERE id = ?", r.current_run);
    if (a?.status === "running" && a.heartbeat_at && Date.now() - Date.parse(a.heartbeat_at) > stallMs()) {
      return { ...base, state: "unhealthy", label: "Worker unhealthy", detail: `The worker is alive but the current audit hasn't progressed for ${Math.round((Date.now() - Date.parse(a.heartbeat_at)) / 60_000)} minutes.` };
    }
  }
  return { ...base, state: "online", label: "Worker online", detail: r.current_run ? "Processing an audit." : "Idle and waiting for audits." };
}
