import type { ReactNode } from "react";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-900 px-4 py-10">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-widest text-accent-600">WebAudit Pro</div>
          <h1 className="mt-1 text-xl font-semibold text-navy-900">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}
