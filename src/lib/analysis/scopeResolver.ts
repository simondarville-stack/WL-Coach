// EMOS Analysis — scope resolver.
//
// Turns an `AnalysisQuery.scope` into a concrete inclusive [from, to] date
// window. Pure and fully testable: macro mode is resolved from the macrocycle
// row that `factFetch` supplies (factFetch is the only module that touches
// Supabase, invariant #6). All date math is UTC-consistent (invariant #4).

import { isoAddDays, isoMonday, toLocalISO } from '../dateUtils';
import type { ISODate, Scope } from './types';

export interface ScopeContext {
  /** Defaults to today (local). Pass explicitly in tests. */
  now?: ISODate;
  /** Required for `scope.mode === 'macro'`; supplied by factFetch. */
  macro?: { start_date: string; end_date: string } | null;
}

export interface ResolvedScope {
  from: ISODate;
  to: ISODate;
  mode: Scope['mode'];
}

function today(ctx: ScopeContext): ISODate {
  return ctx.now ?? toLocalISO(new Date());
}

export function resolveScopeWindow(scope: Scope, ctx: ScopeContext = {}): ResolvedScope {
  switch (scope.mode) {
    case 'dateRange': {
      const from = scope.from.slice(0, 10);
      const to = scope.to.slice(0, 10);
      return { from: from <= to ? from : to, to: from <= to ? to : from, mode: 'dateRange' };
    }
    case 'rolling': {
      const anchor = (scope.anchor ?? today(ctx)).slice(0, 10);
      const window = Math.max(1, Math.floor(scope.windowDays));
      return { from: isoAddDays(anchor, -(window - 1)), to: anchor, mode: 'rolling' };
    }
    case 'macro': {
      if (!ctx.macro) {
        throw new Error(`resolveScopeWindow: macro scope requires a macrocycle (id=${scope.macroId})`);
      }
      return {
        from: ctx.macro.start_date.slice(0, 10),
        to: ctx.macro.end_date.slice(0, 10),
        mode: 'macro',
      };
    }
  }
}

/** Convenience: the Monday week-start of the resolved `from`. */
export function resolvedWeekStart(scope: ResolvedScope): ISODate {
  return isoMonday(scope.from);
}
