/**
 * programmeGate — soft per-programme access codes for the athlete app.
 *
 * A coach can put an `access_code` on an athlete or a training group (see the
 * 20260622 migration). When set, the athlete app makes the viewer type that
 * code once per browser before revealing the programme. When null/empty the
 * programme is open, exactly as before.
 *
 * This is deterrence, not security — the code is stored in plaintext and read
 * with the anon key (no RLS yet). It lives on the same soft-gating surface as
 * the group share link and the VITE_COACH_GATE coach-root gate, and is the
 * natural place to graft real auth onto later.
 *
 * Unlock persistence: we remember a *hash* of the code that cleared the gate,
 * keyed by `${kind}:${id}`, so (a) we don't keep the plaintext lying around in
 * localStorage and (b) rotating the code on the coach side re-locks every
 * browser automatically (the stored hash no longer matches the new code).
 */

type ProgrammeKind = 'athlete' | 'group';

interface Gated {
  id: string;
  access_code?: string | null;
}

const UNLOCK_KEY = 'emos_programme_unlocks';

/** Trim only — codes are case-sensitive so "Squad1" ≠ "squad1". */
export function normalizeCode(code: string | null | undefined): string {
  return (code ?? '').trim();
}

/** True when the programme carries a non-empty access code. */
export function isProgrammeLocked(entity: Gated | null | undefined): boolean {
  return !!entity && normalizeCode(entity.access_code).length > 0;
}

/** djb2 — non-crypto, deterrence-grade. Just avoids storing the raw code. */
function hashCode(code: string): string {
  let h = 5381;
  for (let i = 0; i < code.length; i++) {
    h = (h * 33 + code.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function readUnlocks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(UNLOCK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeUnlocks(map: Record<string, string>): void {
  try {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota — gate just re-prompts next time, no crash */
  }
}

/**
 * Whether this browser has already cleared the gate for `entity` at its
 * *current* code. Open programmes (no code) are always considered unlocked.
 */
export function isUnlocked(kind: ProgrammeKind, entity: Gated): boolean {
  const code = normalizeCode(entity.access_code);
  if (!code) return true;
  return readUnlocks()[`${kind}:${entity.id}`] === hashCode(code);
}

/** Record a successful unlock so the gate doesn't prompt again on this browser. */
export function markUnlocked(kind: ProgrammeKind, entity: Gated): void {
  const code = normalizeCode(entity.access_code);
  if (!code) return;
  const map = readUnlocks();
  map[`${kind}:${entity.id}`] = hashCode(code);
  writeUnlocks(map);
}

/** Constant-ish comparison of an entered code against the programme's code. */
export function codeMatches(entity: Gated, entered: string): boolean {
  const expected = normalizeCode(entity.access_code);
  return expected.length > 0 && normalizeCode(entered) === expected;
}

/** Clear all remembered unlocks (used by the dev `?reset` escape hatch / signOut). */
export function clearAllUnlocks(): void {
  try {
    localStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* ignore */
  }
}
