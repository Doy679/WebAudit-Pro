import Link from "next/link";

export const metadata = { title: "Page not found" };

/** BUG-23: unknown addresses get a branded page with ways back into the app, not Next.js's unstyled default. */
export default function RootNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-50 px-4">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-accent-600">WebAudit Pro</div>
        <h1 className="mt-2 text-xl font-semibold text-navy-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">There&apos;s no page at this address. Check the link, or go back to the app.</p>
        <nav aria-label="Ways back" className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/" className="rounded-md bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-700">Go to Overview</Link>
          <Link href="/issues" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">Issues</Link>
          <Link href="/help" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">Help</Link>
        </nav>
      </div>
    </main>
  );
}
