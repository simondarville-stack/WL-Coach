/**
 * ProgrammeGate — code prompt shown when a selected programme (athlete or
 * group) carries an access_code this browser hasn't cleared. Mirrors the
 * coach-app CoachGate, styled for the athlete app's dark theme.
 *
 * On a correct code the AuthContext commits the selection and remembers the
 * unlock (per browser) so it won't prompt again until the coach rotates it.
 */
import { useState, type FormEvent } from 'react';
import { Lock, ChevronLeft } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

export function ProgrammeGate() {
  const { pending, submitGateCode, cancelGate } = useAuth();
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);

  if (!pending) return null;

  const name = pending.kind === 'athlete' ? pending.athlete.name : pending.group.name;
  const subtitle =
    pending.kind === 'group' ? 'Group plan · view only' : 'Training programme';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!submitGateCode(entry)) {
      setError(true);
    }
    // On success the provider swaps this screen out; nothing else to do.
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-xs">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center mx-auto mb-3">
            <Lock size={20} className="text-[color:var(--color-accent)]" />
          </div>
          <h1 className="text-lg font-bold text-white truncate">{name}</h1>
          <p className="text-xs text-[color:var(--color-text-secondary)] mt-0.5">{subtitle}</p>
          <p className="text-sm text-[color:var(--color-text-secondary)] mt-3">
            Enter the access code your coach gave you.
          </p>
        </div>

        <input
          type="password"
          inputMode="text"
          value={entry}
          onChange={(e) => { setEntry(e.target.value); setError(false); }}
          placeholder="Access code"
          autoFocus
          autoComplete="off"
          aria-label="Access code"
          className="w-full px-4 py-3 text-base rounded-xl bg-[var(--color-bg-primary)] border border-[color:var(--color-border-tertiary)] text-white placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none focus:border-[color:var(--color-accent-hover)]"
        />
        {error && (
          <p className="mt-2 text-xs text-red-400">Incorrect code. Try again.</p>
        )}

        <button
          type="submit"
          className="w-full mt-4 px-4 py-3 rounded-xl bg-[var(--color-accent)] text-white text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Unlock
        </button>

        {/* Only picker-origin gates can go back; a share/personal link has no
            picker to return to (and mustn't expose other profiles). */}
        {!pending.locked && (
          <button
            type="button"
            onClick={cancelGate}
            className="w-full mt-3 inline-flex items-center justify-center gap-1 text-xs text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
          >
            <ChevronLeft size={13} />
            Back to profiles
          </button>
        )}
      </form>
    </div>
  );
}
