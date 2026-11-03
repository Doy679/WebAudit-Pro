// Saved Issues filters, private to each user. Only known filter parameters are stored.
import { all, get, newId, now, run } from "./db";
import type { User } from "./auth";
import { NotFoundError } from "./permissions";
import { FILTER_PARAMS } from "./issue-filters";

export interface SavedView { id: string; name: string; query: string }

export function cleanQuery(query: string): string {
  const src = new URLSearchParams(query);
  const out = new URLSearchParams();
  for (const [k, raw] of src) {
    const v = raw.trim();
    if (v && FILTER_PARAMS.includes(k) && !out.has(k)) out.set(k, v.slice(0, 200));
  }
  return out.toString();
}

export function saveView(user: User, name: string, query: string): SavedView {
  const n = name.trim().slice(0, 80);
  if (!n) throw new Error("Give the view a name.");
  const view = { id: newId(), name: n, query: cleanQuery(query) };
  run("INSERT INTO saved_views (id, user_id, name, query, created_at) VALUES (?, ?, ?, ?, ?)", view.id, user.id, view.name, view.query, now());
  return view;
}

export const listViews = (user: User) =>
  all<SavedView>("SELECT id, name, query FROM saved_views WHERE user_id = ? ORDER BY created_at", user.id);

export function deleteView(user: User, id: string) {
  if (!get("SELECT 1 FROM saved_views WHERE id = ? AND user_id = ?", id, user.id)) throw new NotFoundError("Saved view not found.");
  run("DELETE FROM saved_views WHERE id = ? AND user_id = ?", id, user.id);
}
