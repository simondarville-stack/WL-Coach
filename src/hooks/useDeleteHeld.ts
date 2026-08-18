import { useSyncExternalStore } from 'react';

// Module-level singleton store: the hook is instantiated once per exercise
// row / chip, so per-instance window listeners multiply fast (150+ on a full
// planner week). One shared set of listeners feeds every subscriber instead;
// listeners are installed when the first subscriber arrives and removed when
// the last one leaves.

let deleteHeld = false;
const subscribers = new Set<() => void>();

function setHeld(next: boolean) {
  if (next === deleteHeld) return;
  deleteHeld = next;
  subscribers.forEach(cb => cb());
}

const down = (e: KeyboardEvent) => { if (e.key === 'Delete') setHeld(true); };
const up = (e: KeyboardEvent) => { if (e.key === 'Delete') setHeld(false); };
const blur = () => setHeld(false);

function subscribe(cb: () => void): () => void {
  if (subscribers.size === 0) {
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
  }
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0) {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      // Match the old per-instance behaviour: a fresh mount starts unheld.
      deleteHeld = false;
    }
  };
}

function getSnapshot(): boolean {
  return deleteHeld;
}

export function useDeleteHeld(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
