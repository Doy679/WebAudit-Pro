import { packageEvidence } from "@/server/approvals";
import { readEvidence } from "@/server/files";

export const dynamic = "force-dynamic";

/** Evidence for the client approval page: only findings released in that (valid, unexpired) package. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string; issueId: string; which: string }> }) {
  const { token, issueId, which } = await params;
  const ref = packageEvidence(token, issueId, which === "annotated" ? "annotated" : Number(which));
  if (!ref) return new Response("Not found", { status: 404 });
  const file = await readEvidence(ref.runId, ref.path);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.body), { headers: { "content-type": file.type, "cache-control": "private, no-store" } });
}
