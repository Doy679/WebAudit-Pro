// Background worker: claims audit and export jobs from the database and runs them outside the web server.
// Start with `npm run worker` (or `npm run dev`, which starts web + worker together).
import { existsSync } from "node:fs";
import { claimNextJob, failOrphanedRuns, finishJob } from "../server/runs";
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
    try {
      const status = await handle(job.ref_id);
      finishJob(job.id, status);
      log(`${type} job ${job.id} ${status}`);
    } catch (e) {
      finishJob(job.id, "failed", (e as Error).message);
      log(`${type} job ${job.id} crashed: ${(e as Error).message}`);
    }
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    log("Stopping after current jobs… (a running audit will be marked interrupted on next start)");
    setTimeout(() => process.exit(0), 2000);
  });
}

const orphaned = failOrphanedRuns();
if (orphaned) log(`Marked ${orphaned} interrupted audit(s) as failed.`);
log("Waiting for jobs…");

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
