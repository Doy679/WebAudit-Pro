"use client";

import { useEffect } from "react";

/**
 * Optional keyboard shortcuts for the review queue: each key clicks the button with that data-key. Ignored while
 * typing in a field, and when a modifier key is held, so normal browser shortcuts keep working.
 */
export function ReviewShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const btn = document.querySelector<HTMLElement>(`[data-key="${e.key.toLowerCase()}"]`);
      if (btn && !(btn as HTMLButtonElement).disabled) { e.preventDefault(); btn.click(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
