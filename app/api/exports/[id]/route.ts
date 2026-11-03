import { readFile } from "node:fs/promises";
import { currentUser } from "@/app/lib/session";
import { getExport } from "@/server/exports";

export const dynamic = "force-dynamic";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
} as const;

/** Report download for signed-in project members. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  let exp;
  try {
    exp = getExport(user, (await params).id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (exp.status !== "completed" || !exp.file_path) return new Response("Report is not ready", { status: 409 });
  const body = await readFile(exp.file_path).catch(() => null);
  if (!body) return new Response("Report file is missing", { status: 410 });
  const name = (exp.file_name ?? `report.${exp.format}`).replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": TYPES[exp.format],
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
