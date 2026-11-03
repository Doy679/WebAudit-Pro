"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/projects", label: "My Websites" },
  { href: "/audits/new", label: "New Audit" },
  { href: "/audits", label: "Audit Runs" },
  { href: "/issues", label: "Issues" },
  { href: "/reports", label: "Reports" },
  { href: "/approvals", label: "Client Approvals" },
  { href: "/reaudit", label: "Re-Audit" },
  { href: "/google", label: "Google SEO & Performance" },
  { href: "/settings", label: "Settings" },
];

const isActive = (path: string, href: string) =>
  href === "/" ? path === "/" : href === "/audits" ? path === "/audits" || /^\/audits\/(?!new)/.test(path) : path.startsWith(href);

export function Nav({ userName, roleLabel, logout, worker }: { userName: string; roleLabel: string; logout: () => Promise<void>; worker: { state: string; label: string } }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between bg-navy-900 px-4 py-3 text-white lg:hidden">
        <span className="font-semibold">WebAudit Pro</span>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="main-nav" className="rounded border border-white/30 px-3 py-1 text-sm">
          Menu
        </button>
      </div>
      <aside
        id="main-nav"
        className={cx("bg-navy-900 text-white lg:w-60 lg:shrink-0", open ? "block" : "hidden lg:block")}
      >
        <div className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="hidden px-5 pb-4 pt-6 lg:block">
          <div className="text-xs font-semibold uppercase tracking-widest text-accent-500">WebAudit Pro</div>
          <div className="mt-0.5 text-xs text-white/60">Read-only website audits</div>
        </div>
        <nav aria-label="Main" className="flex-1 px-3 py-2">
          <ul className="space-y-0.5">
            {ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(path, item.href) ? "page" : undefined}
                  className={cx(
                    "block rounded-md px-3 py-2 text-sm",
                    isActive(path, item.href) ? "bg-white/10 font-semibold text-white" : "text-white/75 hover:bg-white/5 hover:text-white",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-sm">
          <div className="truncate font-medium">{userName}</div>
          <div className="text-xs text-white/60">{roleLabel}</div>
          <div className="mt-2 flex items-center gap-1.5 text-xs" data-testid="nav-worker" data-state={worker.state} title="Background audit worker">
            <span className={cx("inline-block h-2 w-2 rounded-full", worker.state === "online" ? "bg-green-400" : worker.state === "starting" ? "bg-sky-300" : "bg-amber-400")} />
            {worker.label}
          </div>
          <form action={logout} className="mt-2">
            <button type="submit" className="text-xs text-white/80 underline hover:text-white">Sign out</button>
          </form>
        </div>
        </div>
      </aside>
    </>
  );
}
