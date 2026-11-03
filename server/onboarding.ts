// "Getting started" checklist. Steps are derived from real data the user can see; only the dismissal is stored.
import { get, run } from "./db";
import type { User } from "./auth";
import { projectScope } from "./permissions";

export interface OnboardingStep { key: string; label: string; hint: string; href: string; done: boolean }

export function onboardingState(user: User): { dismissed: boolean; steps: OnboardingStep[] } {
  const scope = projectScope(user, "project_id");
  const exists = (sql: string) => !!get(`SELECT 1 WHERE EXISTS (${sql})`, ...scope.params);
  const p = projectScope(user, "id");
  const steps: OnboardingStep[] = [
    { key: "project", label: "Add your website", hint: "Create a project for a site you're authorized to audit.", href: "/projects",
      done: !!get(`SELECT 1 FROM projects WHERE ${p.sql} LIMIT 1`, ...p.params) },
    { key: "audit", label: "Run your first audit", hint: "Pick the website and press Start. It runs in the background.", href: "/audits/new",
      done: exists(`SELECT 1 FROM audit_runs WHERE ${scope.sql} AND status = 'completed'`) },
    { key: "review", label: "Review the issues found", hint: "Confirm real problems or mark false positives.", href: "/issues?quick=high",
      done: exists(`SELECT 1 FROM issues WHERE ${scope.sql} AND (verification_status != 'unverified' OR review_status != 'pending')`) },
    { key: "report", label: "Download a report", hint: "Excel for developers, PDF for clients.", href: "/reports",
      done: exists(`SELECT 1 FROM exports WHERE ${scope.sql} AND status = 'completed'`) },
    { key: "approval", label: "Ask your client for approval", hint: "Share a private link with reviewed findings.", href: "/approvals",
      done: exists(`SELECT 1 FROM approval_packages WHERE ${scope.sql}`) },
  ];
  const dismissed = !!get("SELECT 1 FROM user_prefs WHERE user_id = ? AND key = 'onboarding_dismissed'", user.id);
  return { dismissed, steps };
}

export function dismissOnboarding(user: User, dismissed = true) {
  if (dismissed) run("INSERT OR REPLACE INTO user_prefs (user_id, key, value) VALUES (?, 'onboarding_dismissed', '1')", user.id);
  else run("DELETE FROM user_prefs WHERE user_id = ? AND key = 'onboarding_dismissed'", user.id);
}
