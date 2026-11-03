import { NextResponse } from "next/server";
import { currentUser } from "@/app/lib/session";
import { startOAuth } from "@/server/google/service";

export const dynamic = "force-dynamic";
const OAUTH_COOKIE = "wa_google_oauth";

/** Starts Google OAuth. State + PKCE verifier live in a short-lived encrypted httpOnly cookie. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  try {
    const { url, cookie } = startOAuth(user);
    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_COOKIE, cookie, {
      httpOnly: true, sameSite: "lax", path: "/api/google/oauth", maxAge: 600,
      secure: (process.env.WEBAUDIT_APP_URL ?? "").startsWith("https://"),
    });
    return res;
  } catch (e) {
    return NextResponse.redirect(new URL(`/google/connections?error=${encodeURIComponent((e as Error).message)}`, req.url));
  }
}
