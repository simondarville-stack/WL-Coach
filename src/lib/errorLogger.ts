/**
 * EMOS in-app error logger.
 *
 * Three capture paths feed a single Supabase table (error_logs):
 *   - React component crashes via ErrorBoundary.componentDidCatch
 *   - Uncaught window 'error' and 'unhandledrejection' events
 *   - Explicit logError() calls from service layers (Supabase errors etc.)
 *
 * Each log carries the last N breadcrumbs (route changes, button clicks,
 * mutation calls) so reviewers see the lead-up — not just the crash.
 *
 * Design constraints:
 *   - Never throw. Any failure inside the logger is swallowed with a
 *     console.error so it can't cascade into another captured event.
 *   - Cheap on the hot path: addBreadcrumb is synchronous, in-memory,
 *     and bounded. logError fires a single insert and forgets.
 *   - Actor identity is resolved through a registrable function so this
 *     module stays decoupled from the coach store and the athlete auth
 *     context (which live in different subtrees and shouldn't import
 *     each other).
 */
import { supabase } from './supabase';
import type { ErrorBreadcrumb } from './database.types';

const MAX_BREADCRUMBS = 25;

let breadcrumbs: ErrorBreadcrumb[] = [];

export function addBreadcrumb(crumb: Omit<ErrorBreadcrumb, 'ts'>): void {
  breadcrumbs.push({ ts: new Date().toISOString(), ...crumb });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs = breadcrumbs.slice(-MAX_BREADCRUMBS);
  }
}

export function getBreadcrumbs(): ReadonlyArray<ErrorBreadcrumb> {
  return breadcrumbs;
}

export function clearBreadcrumbs(): void {
  breadcrumbs = [];
}

export interface ActorContext {
  role: 'coach' | 'athlete' | 'unknown';
  id: string | null;
  label: string | null;
}

let resolveActor: () => ActorContext = () => ({ role: 'unknown', id: null, label: null });

export function setActorResolver(fn: () => ActorContext): void {
  resolveActor = fn;
}

interface NormalisedError {
  name: string;
  message: string;
  stack: string | null;
  code: string | null;
}

function normaliseError(err: unknown): NormalisedError {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack ?? null,
      code: (err as { code?: string }).code ?? null,
    };
  }
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string; stack?: string; code?: string };
    return {
      name: e.name ?? 'UnknownError',
      message: e.message ?? safeStringify(err),
      stack: e.stack ?? null,
      code: e.code ?? null,
    };
  }
  return { name: 'UnknownError', message: String(err), stack: null, code: null };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserialisable]';
  }
}

export type ErrorSource = 'react' | 'window' | 'promise' | 'manual' | 'supabase';

export interface LogErrorOptions {
  source?: ErrorSource;
  context?: Record<string, unknown>;
}

export async function logError(err: unknown, opts: LogErrorOptions = {}): Promise<void> {
  try {
    const { name, message, stack, code } = normaliseError(err);
    const actor = resolveActor();

    const payload = {
      source: opts.source ?? 'manual',
      name,
      message,
      stack,
      error_code: code,
      url: typeof location !== 'undefined' ? location.pathname + location.search : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      app_version: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? null,
      actor_role: actor.role,
      actor_id: actor.id,
      actor_label: actor.label,
      breadcrumbs: breadcrumbs.slice(),
      context: opts.context ?? null,
    };

    const { error } = await supabase.from('error_logs').insert(payload);
    if (error) {
      // Don't re-enter the logger from here — just surface to the console.
      // eslint-disable-next-line no-console
      console.error('[errorLogger] insert failed', error);
    }
  } catch (loggerErr) {
    // eslint-disable-next-line no-console
    console.error('[errorLogger] internal failure', loggerErr);
  }
}

/**
 * Install the document-level capture for unhandled errors and clicks.
 * Idempotent — calling twice replaces nothing because we use named
 * handlers stored on a module flag.
 */
let installed = false;
export function installGlobalHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    void logError(event.error ?? new Error(event.message), {
      source: 'window',
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    void logError(event.reason, { source: 'promise' });
  });

  // Click breadcrumbs. Walk up from the click target looking for an
  // explicit data-track attribute first, then fall back to the nearest
  // interactive element's accessible name. Captured at the document
  // level so we don't need to instrument every button.
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      if (!target) return;
      const tracked = target.closest('[data-track]');
      if (tracked) {
        addBreadcrumb({
          category: 'click',
          message: tracked.getAttribute('data-track') ?? 'click',
        });
        return;
      }
      const interactive = target.closest('button, [role="button"], a[href]');
      if (interactive) {
        const label =
          interactive.getAttribute('aria-label') ??
          (interactive.textContent ?? '').trim();
        if (label) {
          addBreadcrumb({
            category: 'click',
            message: label.slice(0, 80),
          });
        }
      }
    },
    { capture: true },
  );
}
