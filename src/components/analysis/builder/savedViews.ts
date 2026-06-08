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
  description?: string;
  version: number;
  createdAt?: string; // ISO date set by the UI at save (engine has no clock)
  lastRunAt?: string; // ISO date the view was last opened
  isDefault?: boolean; // the coach's preferred starting layout
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

/** True when a view with this name already exists (the save would overwrite). */
export function viewExists(name: string): boolean {
  const id = slug(name);
  return loadSavedViews().some((v) => v.id === id);
}

/** Create or overwrite a view by name, preserving prior metadata. */
export function saveView(name: string, state: BuilderState, opts: { description?: string; now?: string } = {}): SavedView[] {
  const views = loadSavedViews();
  const id = slug(name);
  const existing = views.find((v) => v.id === id);
  const next = views.filter((v) => v.id !== id);
  next.push({
    id,
    name: name.trim(),
    description: opts.description?.trim() || existing?.description,
    version: VERSION,
    createdAt: existing?.createdAt ?? opts.now,
    lastRunAt: existing?.lastRunAt,
    isDefault: existing?.isDefault,
    state,
  });
  next.sort((a, b) => a.name.localeCompare(b.name));
  persist(next);
  return next;
}

export function deleteView(id: string): SavedView[] {
  const next = loadSavedViews().filter((v) => v.id !== id);
  persist(next);
  return next;
}

/** Mark exactly one view as the default (or none when id is null). */
export function setDefaultView(id: string | null): SavedView[] {
  const next = loadSavedViews().map((v) => ({ ...v, isDefault: v.id === id }));
  persist(next);
  return next;
}

export function getDefaultView(): SavedView | undefined {
  return loadSavedViews().find((v) => v.isDefault);
}

/** Stamp a view's last-opened time. Returns the updated list. */
export function touchView(id: string, now: string): SavedView[] {
  const next = loadSavedViews().map((v) => (v.id === id ? { ...v, lastRunAt: now } : v));
  persist(next);
  return next;
}
