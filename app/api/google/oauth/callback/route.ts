import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/app/lib/session";
import { completeOAuth } from "@/server/google/service";

export const dynamic = "force-dynamic";
const OAUTH_COOKIE = "wa_google_oauth";

/** Google redirects here after consent. The code is exchanged server-side; tokens never reach the browser. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const params = new URL(req.url).searchParams;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/google/connections?${q}`, req.url));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/google/oauth" });
    return res;
  };
  if (params.get("error")) return back(`error=${encodeURIComponent(params.get("error") === "access_denied" ? "Google access was not granted." : `Google returned: ${params.get("error")}`)}`);
  try {
    const jar = await cookies();
    await completeOAuth(user, { code: params.get("code") ?? "", state: params.get("state") ?? "", cookie: jar.get(OAUTH_COOKIE)?.value });
    return back("connected=1");
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message)}`);
  }
}
