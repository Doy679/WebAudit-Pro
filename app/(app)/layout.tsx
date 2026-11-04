import { requireUser } from "@/app/lib/session";
import { logoutAction } from "@/app/actions";
import { ROLE_LABELS } from "@/server/auth";
import { Nav } from "@/components/Nav";
import { workerStatus } from "@/server/worker-status";
import { can } from "@/server/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="lg:flex lg:min-h-screen">
      <Nav userName={user.name} roleLabel={ROLE_LABELS[user.role]} logout={logoutAction} worker={(({ state, label }) => ({ state, label }))(workerStatus())} canReview={can(user, "issue:review")} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
