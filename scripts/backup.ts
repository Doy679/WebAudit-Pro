// Consistent online backup of the WebAudit Pro database: npm run backup [-- <folder>]
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { backupDatabase } = await import("../server/backup");
const { file } = backupDatabase(process.argv[2]);
console.log(`Backup written: ${file}`);
console.log("Screenshots and reports are in data/runs and data/exports; copy those folders too for a full backup.");
