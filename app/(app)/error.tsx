"use client";

import Link from "@/components/AppLink";

/**
 * Shown when a page fails to render. Server error details are never shown in the browser; the reference
 * (Next.js digest) matches the line in the server log, so an admin can find the exact error.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center" role="alert">
      <h1 className="text-xl font-semibold text-navy-900">This page couldn&apos;t be loaded</h1>
      <p className="mt-2 text-sm text-slate-600">
        Something went wrong while preparing this page. Your data is safe; nothing was changed. Try again, or go back and adjust any filters you applied.
      </p>
      {error.digest && (
        <p className="mt-3 text-xs text-slate-500">
          Reference for your administrator: <code className="select-all rounded bg-slate-100 px-1">{error.digest}</code> (search the server log for this code)
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button onClick={reset} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Try again</button>
        <Link href="/" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Go to Overview</Link>
        <Link href="/help" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">Help</Link>
      </div>
    </div>
  );
}
