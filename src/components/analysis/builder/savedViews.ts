// Saved analysis views, persisted to localStorage for v1 (per-device). The
// gated `analysis_views` table (DC-01) is a later sign-off-required swap that
// makes views cross-device/shareable behind this same shape. `version` lets the
// persisted BuilderState be migrated when the builder grows new fields.

import type { BuilderState } from './builderState';

const KEY = 'emos.analysis.savedViews.v1';
const VERSION = 1;

export interface SavedView {
  id: string;
  name: string;
  version: number;
  state: BuilderState;
}

export function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}

function persist(views: SavedView[]): void {
  localStorage.setItem(KEY, JSON.stringify(views));
}

function slug(name: string): string {
  return 'view_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Create or overwrite a view by name. Returns the updated list. */
export function saveView(name: string, state: BuilderState): SavedView[] {
  const views = loadSavedViews();
  const id = slug(name);
  const next = views.filter((v) => v.id !== id);
  next.push({ id, name: name.trim(), version: VERSION, state });
  next.sort((a, b) => a.name.localeCompare(b.name));
  persist(next);
  return next;
}

export function deleteView(id: string): SavedView[] {
  const next = loadSavedViews().filter((v) => v.id !== id);
  persist(next);
  return next;
}
