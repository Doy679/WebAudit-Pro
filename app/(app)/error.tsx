"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold text-navy-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">{error.message || "The page could not be loaded."}</p>
      <button onClick={reset} className="mt-4 rounded-md border border-slate-300 px-3 py-2 text-sm">Try again</button>
    </div>
  );
}
