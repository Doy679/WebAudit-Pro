"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";
import { btn, cx, Notice } from "./ui";

/** A form bound to a server action, showing its error/success message. */
export function ActionForm({
  action, children, className, resetKey,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetKey?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className} key={resetKey}>
      {children}
      {state?.error && <div className="mt-3"><Notice tone="error">{state.error}</Notice></div>}
      {state?.ok && <div className="mt-3"><Notice tone="ok">{state.ok}</Notice></div>}
      {state?.link && <CopyLink link={state.link} />}
    </form>
  );
}

export function Submit({ children, variant = "primary", name, value, className, disabled = false, title }: {
  children: ReactNode; variant?: keyof typeof btn; name?: string; value?: string; className?: string; disabled?: boolean; title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} title={title} className={cx(btn[variant], className)} aria-busy={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-slate-50 p-2">
      <input readOnly value={link} aria-label="Approval link" className="min-w-0 flex-1 bg-transparent font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid="approval-link" />
      <button
        type="button"
        className={btn.secondary}
        onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

/** Checkbox that toggles every `name` checkbox inside the closest form. */
export function SelectAll({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all on this page"
      onChange={(e) => {
        e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => (c.checked = e.currentTarget.checked));
      }}
    />
  );
}
