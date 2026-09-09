// EMOS assistant CLI — the hands behind the `emos` skill (.claude/skills/emos).
//
//   npm run emos -- athletes [--all]
//   npm run emos -- week        --athlete <name|id> [--week this|next|last|YYYY-MM-DD]
//   npm run emos -- copy-week   --athlete <name|id> [--from this] [--to next]
//   npm run emos -- scale-loads --athlete <name|id> [--week next] (--factor 0.8 | --by=-20)
//                               [--exercise <name>]… [--category <name>]… [--id <uuid>]…
//                               [--day <n>]… [--include-combos] [--round-kg 2.5] [--round-pct 1]
//                               [--apply] [--json]
//   global: [--env .env] [--json]
//
// Every write goes through the same modules the planner uses
// (src/lib/weekDraftService.ts, src/lib/loadScaleService.ts →
// src/lib/prescriptionWriteService.ts), so the summary and set-line caches
// are rebuilt exactly as a planner edit would rebuild them. `scale-loads` is
// a DRY RUN unless `--apply` is given. Group plans are refused.
//
// Runs through scripts/emos.mjs, which bundles this file with esbuild (the
// src modules use extensionless imports Node's loader will not resolve).
// The launcher sets EMOS_ROOT to the repo root.

import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database, WeekPlan } from '../src/lib/database.types';
import { getMondayOfWeekISO } from '../src/lib/weekUtils';
import { addDaysToISO } from '../src/lib/dateUtils';
import { copyWeekAsDraft } from '../src/lib/weekDraftService';
import {
  scaleWeekLoads,
  DEFAULT_ROUNDING,
  type LoadChange,
  type RoundingRule,
} from '../src/lib/loadScaleService';
import type { EmosClient } from '../src/lib/prescriptionWriteService';

// ─── Plumbing ────────────────────────────────────────────────────────────────

class UsageError extends Error {}

const ROOT = process.env.EMOS_ROOT ?? process.cwd();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadEnvFile(file: string): Record<string, string> {
  const path = join(ROOT, file);
  if (!existsSync(path)) throw new UsageError(`env file not found: ${path}`);
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function makeClient(envFile: string): { client: EmosClient; host: string } {
  const env = loadEnvFile(envFile);
  const url = process.env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new UsageError(`${envFile} has no VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY`);
  return { client: createClient<Database>(url, key), host: new URL(url).host };
}

const log = (msg: string) => process.stderr.write(msg + '\n');

// ─── Resolution ──────────────────────────────────────────────────────────────

interface AthleteLite { id: string; name: string; is_active: boolean; owner_id: string }

async function listAthletes(client: EmosClient, includeInactive: boolean): Promise<AthleteLite[]> {
  let q = client.from('athletes').select('id, name, is_active, owner_id').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as AthleteLite[]) ?? [];
}

async function resolveAthlete(client: EmosClient, term: string | undefined): Promise<AthleteLite> {
  if (!term) throw new UsageError('--athlete <name|id> is required');
  const all = await listAthletes(client, true);
  if (UUID_RE.test(term)) {
    const hit = all.find(a => a.id.toLowerCase() === term.toLowerCase());
    if (hit) return hit;
    throw new UsageError(`no athlete with id ${term}`);
  }
  const t = term.trim().toLowerCase();
  const exact = all.filter(a => a.name.trim().toLowerCase() === t);
  if (exact.length === 1) return exact[0];
  const partial = all.filter(a => a.name.toLowerCase().includes(t));
  if (partial.length === 1) return partial[0];
  const pool = exact.length > 1 ? exact : partial;
  if (pool.length === 0) throw new UsageError(`no athlete matches "${term}" — run \`athletes --all\``);
  throw new UsageError(
    `"${term}" is ambiguous — pass the id:\n` + pool.map(a => `  ${a.id}  ${a.name}${a.is_active ? '' : '  (inactive)'}`).join('\n'),
  );
}

/** 'this' | 'next' | 'last' | ISO date → Monday ISO. A non-Monday date snaps back. */
function resolveWeek(term: string | undefined, fallback: 'this' | 'next'): string {
  const thisMonday = getMondayOfWeekISO(new Date());
  const t = (term ?? fallback).trim().toLowerCase();
  if (t === 'this' || t === 'current') return thisMonday;
  if (t === 'next') return addDaysToISO(thisMonday, 7);
  if (t === 'last' || t === 'previous') return addDaysToISO(thisMonday, -7);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new UsageError(`bad week "${term}" — use this | next | last | YYYY-MM-DD`);
  const monday = getMondayOfWeekISO(new Date(t + 'T00:00:00'));
  if (monday !== t) log(`note: ${t} is not a Monday — using the week of ${monday}`);
  return monday;
}

async function findIndividualPlan(client: EmosClient, athleteId: string, weekStart: string): Promise<WeekPlan | null> {
  const { data, error } = await client
    .from('week_plans')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .is('group_id', null)
    .maybeSingle();
  if (error) throw error;
  return (data as WeekPlan | null) ?? null;
}

// ─── Output ──────────────────────────────────────────────────────────────────

/** Day-first, as everywhere in EMOS. */
function ddmm(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function table(rows: string[][], header: string[]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map(r => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  return [line(header), widths.map(w => '─'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

function dayName(plan: WeekPlan, dayIndex: number): string {
  const label = plan.day_labels?.[dayIndex];
  return label ? `D${dayIndex + 1} ${label}` : `D${dayIndex + 1}`;
}

// ─── Commands ────────────────────────────────────────────────────────────────

interface Ctx { client: EmosClient; host: string; json: boolean }

async function cmdAthletes(ctx: Ctx, v: Args): Promise<void> {
  const athletes = await listAthletes(ctx.client, !!v.all);
  if (ctx.json) { console.log(JSON.stringify({ athletes }, null, 2)); return; }
  console.log(table(
    athletes.map(a => [a.name, a.is_active ? 'active' : 'inactive', a.id]),
    ['Athlete', 'Status', 'Id'],
  ));
}

async function cmdWeek(ctx: Ctx, v: Args): Promise<void> {
  const athlete = await resolveAthlete(ctx.client, v.athlete);
  const weekStart = resolveWeek(v.week, 'this');
  const plan = await findIndividualPlan(ctx.client, athlete.id, weekStart);
  if (!plan) {
    if (ctx.json) { console.log(JSON.stringify({ athlete, weekStart, plan: null, rows: [] })); return; }
    console.log(`${athlete.name} — week of ${ddmm(weekStart)}: no individual plan`);
    return;
  }
  const { data, error } = await ctx.client
    .from('planned_exercises')
    .select('id, day_index, position, exercise_id, unit, prescription_raw, display_name, is_combo, combo_notation, notes, source')
    .eq('weekplan_id', plan.id)
    .order('day_index')
    .order('position');
  if (error) throw error;
  type Row = {
    id: string; day_index: number; position: number; exercise_id: string; unit: string | null;
    prescription_raw: string | null; display_name: string | null; is_combo: boolean;
    combo_notation: string | null; notes: string | null; source: string | null;
  };
  const rows = (data as unknown as Row[]) ?? [];
  const exIds = [...new Set(rows.map(r => r.exercise_id))];
  const names = new Map<string, string>();
  if (exIds.length > 0) {
    const { data: ex } = await ctx.client.from('exercises').select('id, name').in('id', exIds);
    for (const e of (ex as unknown as { id: string; name: string }[]) ?? []) names.set(e.id, e.name);
  }
  const labelled = rows.map(r => ({
    ...r,
    label: r.display_name ?? (r.is_combo ? r.combo_notation : null) ?? names.get(r.exercise_id) ?? r.exercise_id,
    day: dayName(plan, r.day_index),
  }));
  if (ctx.json) { console.log(JSON.stringify({ athlete, weekStart, plan, rows: labelled }, null, 2)); return; }
  console.log(`${athlete.name} — week of ${ddmm(weekStart)}  (week_plans.id ${plan.id})`);
  console.log(table(
    labelled.map(r => [r.day, String(r.position), r.label + (r.is_combo ? ' [combo]' : ''), r.unit ?? '', r.prescription_raw ?? '', r.notes ?? '']),
    ['Day', '#', 'Exercise', 'Unit', 'Prescription', 'Notes'],
  ));
}

async function cmdCopyWeek(ctx: Ctx, v: Args): Promise<void> {
  const athlete = await resolveAthlete(ctx.client, v.athlete);
  const from = resolveWeek(v.from, 'this');
  const to = resolveWeek(v.to, 'next');
  if (from === to) throw new UsageError('--from and --to are the same week');
  const result = await copyWeekAsDraft(ctx.client, {
    athleteId: athlete.id, sourceWeekStart: from, targetWeekStart: to, editorCoachId: v.coach,
  });
  if (ctx.json) { console.log(JSON.stringify({ athlete, from, to, ...result }, null, 2)); }
  else if (result.status === 'copied') {
    console.log(`copied ${result.copiedExercises} exercise rows: ${athlete.name} ${ddmm(from)} → ${ddmm(to)}  (week_plans.id ${result.targetWeekPlanId})`);
  } else if (result.status === 'occupied') {
    console.log(`refused: ${athlete.name}'s week of ${ddmm(to)} already has planned work (week_plans.id ${result.targetWeekPlanId}). Nothing written.`);
  } else {
    console.log(`nothing to copy: ${athlete.name} has no planned work in the week of ${ddmm(from)}.`);
  }
  if (result.status !== 'copied') process.exitCode = 2;
}

async function cmdScaleLoads(ctx: Ctx, v: Args): Promise<void> {
  const athlete = await resolveAthlete(ctx.client, v.athlete);
  const weekStart = resolveWeek(v.week, 'next');
  const plan = await findIndividualPlan(ctx.client, athlete.id, weekStart);
  if (!plan) throw new UsageError(`${athlete.name} has no individual plan in the week of ${ddmm(weekStart)} — copy-week first?`);

  let factor: number;
  if (v.factor != null && v.by != null) throw new UsageError('give --factor or --by, not both');
  if (v.factor != null) factor = Number(v.factor);
  else if (v.by != null) factor = 1 + Number(v.by) / 100;
  else throw new UsageError('give --factor 0.8 or --by=-20 (the = matters: a value starting with - needs it)');
  if (!Number.isFinite(factor) || factor <= 0) throw new UsageError(`factor must be > 0 (got ${factor})`);

  const selection = { names: v.exercise ?? [], categories: v.category ?? [], ids: v.id ?? [] };
  if (selection.names.length + selection.categories.length + selection.ids.length === 0) {
    throw new UsageError('select rows with --exercise <name>, --category <name> or --id <uuid> (repeatable)');
  }
  const rounding: RoundingRule = {
    absolute_kg: v['round-kg'] != null ? Number(v['round-kg']) : DEFAULT_ROUNDING.absolute_kg,
    percentage: v['round-pct'] != null ? Number(v['round-pct']) : DEFAULT_ROUNDING.percentage,
  };
  const days = (v.day ?? []).map(d => {
    const n = Number(d);
    if (!Number.isInteger(n) || n < 1) throw new UsageError(`--day takes 1-based day numbers (got ${d})`);
    return n - 1;
  });

  const apply = !!v.apply;
  const result = await scaleWeekLoads(ctx.client, {
    weekPlanId: plan.id, factor, selection, days, includeCombos: !!v['include-combos'], rounding, apply,
  });

  if (ctx.json) {
    console.log(JSON.stringify({ athlete, weekStart, factor, rounding, apply, applied: result.applied, changes: result.changes }, null, 2));
    return;
  }
  const pct = Math.round((factor - 1) * 1000) / 10;
  console.log(`${athlete.name} — week of ${ddmm(weekStart)} — loads × ${factor} (${pct >= 0 ? '+' : ''}${pct} %)  ${apply ? 'APPLIED' : 'DRY RUN'}`);
  if (result.changes.length === 0) {
    console.log('no planned row matched the selection — check `week` for how the exercises are named.');
    process.exitCode = 2;
    return;
  }
  const statusOf = (c: LoadChange) => c.status === 'change' ? (apply ? 'written' : 'would change') : `skip: ${c.skipReason}`;
  console.log(table(
    result.changes.map(c => [dayName(plan, c.dayIndex), String(c.position), c.label + (c.isCombo ? ' [combo]' : ''), c.unit ?? '', c.before, c.after ?? '', statusOf(c), c.via]),
    ['Day', '#', 'Exercise', 'Unit', 'Before', 'After', 'Status', 'Selected via'],
  ));
  const n = result.changes.filter(c => c.status === 'change').length;
  console.log(apply
    ? `\n${result.applied} row${result.applied === 1 ? '' : 's'} written.`
    : `\n${n} row${n === 1 ? '' : 's'} would change. Re-run with --apply to write.`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

type Args = {
  athlete?: string; week?: string; from?: string; to?: string; coach?: string;
  factor?: string; by?: string; exercise?: string[]; category?: string[]; id?: string[]; day?: string[];
  'include-combos'?: boolean; 'round-kg'?: string; 'round-pct'?: string; apply?: boolean;
  all?: boolean; json?: boolean; env?: string; help?: boolean;
};

const USAGE = `usage:
  npm run emos -- athletes [--all]
  npm run emos -- week        --athlete <name|id> [--week this|next|last|YYYY-MM-DD]
  npm run emos -- copy-week   --athlete <name|id> [--from this] [--to next]
  npm run emos -- scale-loads --athlete <name|id> [--week next] (--factor 0.8 | --by=-20)
                              [--exercise <name>]... [--category <name>]... [--id <uuid>]...
                              [--day <n>]... [--include-combos] [--round-kg 2.5] [--round-pct 1]
                              [--apply]
  global: [--env .env] [--json]`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      athlete: { type: 'string' }, week: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
      coach: { type: 'string' }, factor: { type: 'string' }, by: { type: 'string' },
      exercise: { type: 'string', multiple: true }, category: { type: 'string', multiple: true },
      id: { type: 'string', multiple: true }, day: { type: 'string', multiple: true },
      'include-combos': { type: 'boolean' }, 'round-kg': { type: 'string' }, 'round-pct': { type: 'string' },
      apply: { type: 'boolean' }, all: { type: 'boolean' }, json: { type: 'boolean' },
      env: { type: 'string' }, help: { type: 'boolean' },
    },
  });
  const v = values as Args;
  const command = positionals[0];
  if (!command || v.help) { console.log(USAGE); return; }

  const envFile = v.env ?? '.env';
  const { client, host } = makeClient(envFile);
  const ctx: Ctx = { client, host, json: !!v.json };
  log(`emos → ${host} (${envFile})`);

  switch (command) {
    case 'athletes': return cmdAthletes(ctx, v);
    case 'week': return cmdWeek(ctx, v);
    case 'copy-week': return cmdCopyWeek(ctx, v);
    case 'scale-loads': return cmdScaleLoads(ctx, v);
    default: throw new UsageError(`unknown command "${command}"\n${USAGE}`);
  }
}

main().catch((err: unknown) => {
  if (err instanceof UsageError) {
    log(`error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const e = err as { message?: string; details?: string; hint?: string };
  log(`failed: ${e?.message ?? String(err)}${e?.details ? `\n  ${e.details}` : ''}${e?.hint ? `\n  hint: ${e.hint}` : ''}`);
  process.exitCode = 1;
});
