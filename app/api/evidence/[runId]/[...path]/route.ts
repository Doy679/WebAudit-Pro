import { currentUser } from "@/app/lib/session";
import { getRun } from "@/server/runs";
import { readEvidence } from "@/server/files";

export const dynamic = "force-dynamic";

/** Screenshot evidence for signed-in project members only. Never served from a public directory. */
export async function GET(_: Request, { params }: { params: Promise<{ runId: string; path: string[] }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const { runId, path } = await params;
  try {
    getRun(user, runId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const file = await readEvidence(runId, path.map(decodeURIComponent).join("/"));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.body), { headers: { "content-type": file.type, "cache-control": "private, max-age=3600" } });
}
