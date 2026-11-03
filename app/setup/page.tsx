import { redirect } from "next/navigation";
import { userCount } from "@/server/auth";
import { setupAdminAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { input, label, hint } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-time setup" };

export default function SetupPage() {
  if (userCount() > 0) redirect("/login");
  return (
    <AuthShell title="Create the admin account">
      <p className="mb-4 text-sm text-slate-600">This runs once. The admin can then add the rest of the team under Settings.</p>
      <ActionForm action={setupAdminAction} className="space-y-4">
        <div><label htmlFor="name" className={label}>Name</label><input id="name" name="name" required className={`${input} mt-1`} /></div>
        <div><label htmlFor="email" className={label}>Email</label><input id="email" name="email" type="email" required autoComplete="username" className={`${input} mt-1`} /></div>
        <div>
          <label htmlFor="password" className={label}>Password</label>
          <input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" className={`${input} mt-1`} />
          <p className={hint}>At least 10 characters.</p>
        </div>
        <div><label htmlFor="confirm" className={label}>Confirm password</label><input id="confirm" name="confirm" type="password" minLength={10} required autoComplete="new-password" className={`${input} mt-1`} /></div>
        <Submit className="w-full">Create admin and continue</Submit>
      </ActionForm>
    </AuthShell>
  );
}
