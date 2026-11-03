// Starts the web app and the background worker together. `--prod` uses the production build (run `npm run build` first).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync(".env.local")) {
  console.error("Missing .env.local. Run `npm run setup` first.");
  process.exit(1);
}

const prod = process.argv.includes("--prod");
const port = process.env.PORT ?? "3000";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const procs: ChildProcess[] = [
  spawn(npx, ["next", prod ? "start" : "dev", "-p", port], { stdio: "inherit", shell: process.platform === "win32" }),
  spawn(npx, ["tsx", "worker/worker.ts"], { stdio: "inherit", shell: process.platform === "win32" }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => { if (code) { console.error(`A process exited with code ${code}; stopping.`); stop(); } });

console.log(`WebAudit Pro starting on http://localhost:${port} (web + worker). Press Ctrl+C to stop.`);
