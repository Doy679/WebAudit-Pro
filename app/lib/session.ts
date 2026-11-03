import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { sessionUser, type User } from "@/server/auth";
import { can, ForbiddenError, NotFoundError, type Action } from "@/server/permissions";

export const SESSION_COOKIE = "wa_session";

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  return sessionUser(jar.get(SESSION_COOKIE)?.value);
}

/** For pages: redirects to /login when signed out; clients never see the dashboard. */
export async function requireUser(action: Action = "dashboard:view"): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user, action)) redirect(user.role === "client" ? "/login?error=client" : "/?error=forbidden");
  return user;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure whenever the app is served over HTTPS (set WEBAUDIT_APP_URL=https://… in deployment).
    // Tying it to NODE_ENV would silently break sign-in for plain-HTTP LAN installs.
    secure: (process.env.WEBAUDIT_APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: 7 * 86_400,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Loads a record for a page; records the user may not see render as 404 (no hint that they exist). */
export function orNotFound<T>(load: () => T): T {
  try {
    return load();
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof NotFoundError) notFound();
    throw e;
  }
}
