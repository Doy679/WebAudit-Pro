// Background worker: claims audit and export jobs from the database and runs them outside the web server.
// Start with `npm run worker` (or `npm run dev`, which starts web + worker together).
import { existsSync } from "node:fs";
import { claimNextJob, recoverOrphanedRuns, finishJob } from "../server/runs";
import { beat, registerWorker, stopWorker } from "../server/worker-status";
import { processAudit } from "./audit-job";
import { processExport } from "./export-job";
import { claimGoogleTask, processGoogleTask } from "../server/google/service";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const POLL_MS = 1000;
let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[worker ${new Date().toISOString().slice(11, 19)}] ${m}`);

async function loop(type: "audit" | "export", handle: (refId: string) => Promise<"completed" | "failed" | "cancelled">) {
  while (!stopping) {
    const job = claimNextJob(type);
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }
    log(`${type} job ${job.id} started (${job.ref_id})`);
    if (type === "audit") {
      currentRun = job.ref_id;
      beat(workerId, "online", currentRun); // record the current audit immediately, not on the next 5 s tick
    }
    try {
      const status = await handle(job.ref_id);
      finishJob(job.id, status);
      log(`${type} job ${job.id} ${status}`);
    } catch (e) {
      finishJob(job.id, "failed", (e as Error).message);
      log(`${type} job ${job.id} crashed: ${(e as Error).message}`);
    } finally {
      if (type === "audit") {
        currentRun = null;
        beat(workerId, "online", null);
      }
    }
  }
}

// Single instance: a second worker would compete for the same database (claims are atomic, but one is enough).
let workerId: string;
try {
  workerId = registerWorker();
} catch (e) {
  log((e as Error).message);
  process.exit(1);
}
let currentRun: string | null = null;
// Heartbeat on its own timer, so long audit phases never make a healthy worker look offline.
const heartbeat = setInterval(() => {
  try { beat(workerId, "online", currentRun); } catch (e) { log(`heartbeat failed: ${(e as Error).message}`); }
}, Number(process.env.WEBAUDIT_WORKER_HEARTBEAT_MS ?? 5000)); // must stay well below WEBAUDIT_WORKER_STALE_MS

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    clearInterval(heartbeat);
    stopWorker(workerId);
    log("Worker stopped. A running audit is requeued automatically when the worker starts again.");
    setTimeout(() => process.exit(0), 500);
  });
}

const recovered = recoverOrphanedRuns();
if (recovered.requeued) log(`Requeued ${recovered.requeued} audit(s) interrupted by a previous worker stop.`);
if (recovered.failed) log(`Marked ${recovered.failed} repeatedly interrupted audit(s) as failed.`);
beat(workerId, "online");
log("Worker online. Waiting for jobs…");

/** Google requests: one at a time with a pause between them, to stay well inside API quotas. */
async function googleLoop() {
  while (!stopping) {
    const id = claimGoogleTask();
    if (!id) {
      await sleep(POLL_MS);
      continue;
    }
    const status = await processGoogleTask(id).catch((e) => { log(`google task ${id} crashed: ${(e as Error).message}`); return "failed"; });
    log(`google task ${id} ${status}`);
    await sleep(1000);
  }
}

// One audit at a time (bounded browser concurrency); exports and Google requests run alongside.
await Promise.all([loop("audit", (id) => processAudit(id, log)), loop("export", (id) => processExport(id, log)), googleLoop()]);
