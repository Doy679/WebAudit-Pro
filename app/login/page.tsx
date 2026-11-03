import { redirect } from "next/navigation";
import { userCount } from "@/server/auth";
import { currentUser } from "@/app/lib/session";
import { loginAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { input, label, Notice } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (userCount() === 0) redirect("/setup");
  const user = await currentUser();
  if (user && user.role !== "client") redirect("/");
  const { error } = await searchParams;
  return (
    <AuthShell title="Sign in to WebAudit Pro">
      {error === "client" && <div className="mb-4"><Notice tone="warn">Client accounts use the approval link they were sent.</Notice></div>}
      <ActionForm action={loginAction} className="space-y-4">
        <div>
          <label htmlFor="email" className={label}>Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required className={`${input} mt-1`} />
        </div>
        <div>
          <label htmlFor="password" className={label}>Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className={`${input} mt-1`} />
        </div>
        <Submit className="w-full">Sign in</Submit>
      </ActionForm>
    </AuthShell>
  );
}
