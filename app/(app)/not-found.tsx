import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold text-navy-900">Not found</h1>
      <p className="mt-2 text-sm text-slate-600">This page doesn&apos;t exist, or you don&apos;t have access to it. If you need access to a website, ask an admin or project manager to add you to it.</p>
      <Link href="/" className="mt-4 inline-block text-accent-600 underline">Back to overview</Link>
    </div>
  );
}
