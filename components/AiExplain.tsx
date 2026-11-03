"use client";

import { useActionState } from "react";
import type { ExplainState } from "@/app/actions";
import { Submit } from "./forms";
import { Notice } from "./ui";

type State = ExplainState;

export function AiExplain({ issueId, action }: { issueId: string; action: (s: State, fd: FormData) => Promise<State> }) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="issueId" value={issueId} />
      <p className="text-xs text-slate-500">Generates a plain-language explanation and a suggested fix from this finding&apos;s saved measurements. It is a suggestion only: it does not change the finding, and nothing is applied to the website.</p>
      <Submit variant="secondary">{state?.text ? "Regenerate" : "Explain with AI"}</Submit>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.text && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">AI suggestion: not verified</div>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{state.text}</p>
        </div>
      )}
    </form>
  );
}
