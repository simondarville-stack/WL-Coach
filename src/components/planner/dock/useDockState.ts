import { useState, useEffect } from 'react';

export type DockTab = 'exercises' | 'templates';

const TAB_KEY = 'emos_dock_tab';
const COLLAPSED_KEY = 'emos_dock_collapsed';

function readTab(): DockTab {
  const v = typeof window !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
  return v === 'templates' ? 'templates' : 'exercises';
}

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(COLLAPSED_KEY) === 'true';
}

export function useDockState() {
  const [tab, setTab] = useState<DockTab>(readTab);
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  useEffect(() => { localStorage.setItem(TAB_KEY, tab); }, [tab]);
  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); }, [collapsed]);

  return { tab, setTab, collapsed, setCollapsed };
}
