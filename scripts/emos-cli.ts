// EMOS assistant CLI — the hands behind the `emos` skill (.claude/skills/emos).
//
//   npm run emos -- athletes [--all]
//   npm run emos -- week        --athlete <name|id> [--week this|next|last|YYYY-MM-DD]
//   npm run emos -- copy-week   --athlete <name|id> [--from this] [--to next]
//   npm run emos -- scale-loads --athlete <name|id> [--week next] (--factor 0.8 | --by=-20)
//                               [--exercise <name>]… [--category <name>]… [--id <uuid>]…
//                               [--day <n>]… [--include-combos] [--round-kg 2.5] [--round-pct 1]
//                               [--apply] [--json]
//   npm run emos -- new-week    --athlete <name|id> [--week next] [--like this|YYYY-MM-DD]
//   npm run emos -- add-exercise --athlete <name|id> [--week next] --day <n> --exercise <name|id>
//                               [--prescription "87.5×5, 100×5, 115×5-10"] [--unit kg|%|rpe|free|free-reps]
//                               [--note "..."] [--display-name "..."] [--position <n>]
//   npm run emos -- add-combo   --athlete <name|id> [--week next] --day <n> --exercise <name|id> --exercise <name|id>…
//                               [--prescription "80×1+2×3"] [--unit kg|%|rpe|free|free-reps] [--name "Clean + Front Squat"]
//                               [--color "#3B82F6"] [--note "..."] [--position <n>]
//   npm run emos -- edit-exercise --id <planned_exercise_id> [--prescription "..."] [--unit kg|%|rpe|free|free-reps]
//                               [--note "..."|--clear-note] [--display-name "..."] [--time 12|90s|2:15|off]
//                               [--rest 90s|off] [--tempo 3120|off] [--total-reps <n>|off] [--total-sets <n>|off]
//   npm run emos -- swap-exercise --id <planned_exercise_id> --exercise <name|id>
//   npm run emos -- move-exercise --id <planned_exercise_id> [--day <n>] [--position <n>]
//   npm run emos -- add-gpp     --athlete <name|id> [--week next] --day <n> --title "Core" [--description "..."]
//                               --row "Wall sits | 60s | 3" [--row "Plank | 45s | 3 | BW"]… [--position <n>]
//   npm run emos -- edit-gpp    --id <planned_exercise_id> [--title "..."] [--description "..."] [--row "..."]…
//   npm run emos -- remove-exercise --id <planned_exercise_id>
//   npm run emos -- log         --athlete <name|id> [--week this]
//   npm run emos -- prs         --athlete <name|id> [--exercise <name>]
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
import type { Database, DefaultUnit, WeekPlan, PlannedExerciseMetadata, GppRow } from '../src/lib/database.types';
import { formatSeconds } from '../src/lib/exerciseFeatures';
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
import {
  ensureIndividualWeek,
  addPlannedExercise,
  addPlannedCombo,
  removePlannedExercise,
  editPlannedExercise,
  swapPlannedExercise,
  movePlannedExercise,
  addGppBlock,
  editGppBlock,
  parseGppRowSpec,
  parseFeatureFlags,
  pickExercise,
  resolveUnitAlias,
  chooseUnit,
  checkComboPrescription,
  type PickableExercise,
} from '../src/lib/plannedRowService';

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

/** Slots are 1-based and unbounded (DISPLAY_CONVENTIONS §4): day_index 1 is the planner's D1. */
function dayName(plan: WeekPlan, dayIndex: number): string {
  const label = plan.day_labels?.[dayIndex];
  return label ? `D${dayIndex} ${label}` : `D${dayIndex}`;
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
    .select('id, day_index, position, exercise_id, unit, prescription_raw, display_name, is_combo, combo_notation, notes, source, metadata')
    .eq('weekplan_id', plan.id)
    .order('day_index')
    .order('position');
  if (error) throw error;
  type Row = {
    id: string; day_index: number; position: number; exercise_id: string; unit: string | null;
    prescription_raw: string | null; display_name: string | null; is_combo: boolean;
    combo_notation: string | null; notes: string | null; source: string | null; metadata: PlannedExerciseMetadata | null;
  };
  const rows = (data as unknown as Row[]) ?? [];
  const exIds = [...new Set(rows.map(r => r.exercise_id))];
  const names = new Map<string, string>();
  if (exIds.length > 0) {
    const { data: ex } = await ctx.client.from('exercises').select('id, name').in('id', exIds);
    for (const e of (ex as unknown as { id: string; name: string }[]) ?? []) names.set(e.id, e.name);
  }
  const labelled = rows.map(r => {
    const gpp = r.metadata?.gpp;
    const time = r.metadata?.features?.totalTime;
    const label = gpp
      ? `GPP: ${gpp.title || 'GPP'}`
      : r.display_name ?? (r.is_combo ? r.combo_notation : null) ?? names.get(r.exercise_id) ?? r.exercise_id;
    const content = gpp
      ? gpp.rows.map(g => gppRowText(g)).join(' · ')
      : (r.prescription_raw ?? '') + (time ? `  ⏱${formatSeconds(time)}` : '');
    return { ...r, label, content, day: dayName(plan, r.day_index) };
  });
  if (ctx.json) { console.log(JSON.stringify({ athlete, weekStart, plan, rows: labelled }, null, 2)); return; }
  console.log(`${athlete.name} — week of ${ddmm(weekStart)}  (week_plans.id ${plan.id})`);
  console.log(table(
    labelled.map(r => [r.day, String(r.position), r.label + (r.is_combo ? ' [combo]' : ''), r.metadata?.gpp ? '' : (r.unit ?? ''), r.content, oneLine(r.notes), r.id]),
    ['Day', '#', 'Exercise', 'Unit', 'Prescription', 'Notes', 'Id'],
  ));
}

/** "Wall sits 60s×3 (24 kg)" — a GPP row on one line. */
function gppRowText(g: GppRow): string {
  const reps = g.reps ? ` ${g.reps}` : '';
  const sets = g.sets && g.sets !== 1 ? `×${g.sets}` : '';
  const load = g.load ? ` (${g.load})` : '';
  return `${g.exercise}${reps}${sets}${load}`;
}

function oneLine(s: string | null | undefined): string {
  return (s ?? '').replace(/\s*\n+\s*/g, ' / ').trim();
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
    if (!Number.isInteger(n) || n < 1) throw new UsageError(`--day takes the planner's slot numbers, D1 = 1 (got ${d})`);
    return n;
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


// ─── Rows & weeks ────────────────────────────────────────────────────────────

type CatalogueRow = PickableExercise & { default_unit: string; category: string | null; library_id: string | null };

async function loadCatalogue(client: EmosClient): Promise<{ rows: CatalogueRow[]; libraryName: Map<string, string> }> {
  const [{ data, error }, { data: libs }] = await Promise.all([
    client.from('exercises').select('id, name, exercise_code, aliases, owner_id, is_archived, default_unit, category, library_id').order('name'),
    client.from('exercise_libraries').select('id, name'),
  ]);
  if (error) throw error;
  const libraryName = new Map(((libs as unknown as { id: string; name: string }[]) ?? []).map(l => [l.id, l.name]));
  return { rows: (data as unknown as CatalogueRow[]) ?? [], libraryName };
}

/** Every exercise this coach has planned, in any week they own — the best tie-break for a duplicate name. */
async function exercisesUsedByCoach(client: EmosClient, ownerId: string): Promise<Set<string>> {
  const { data, error } = await client
    .from('planned_exercises')
    .select('exercise_id, week_plans!inner(owner_id)')
    .eq('week_plans.owner_id', ownerId);
  if (error) return new Set();
  return new Set(((data as unknown as { exercise_id: string }[]) ?? []).map(r => r.exercise_id));
}

async function resolveExercise(client: EmosClient, term: string | undefined, preferOwnerId: string): Promise<CatalogueRow> {
  if (!term) throw new UsageError('--exercise <name|id> is required');
  const [{ rows, libraryName }, preferIds] = await Promise.all([loadCatalogue(client), exercisesUsedByCoach(client, preferOwnerId)]);
  const pick = pickExercise(term, rows, { preferIds, preferOwnerId });
  if (pick.kind === 'one') return pick.exercise;
  if (pick.kind === 'none') throw new UsageError(`no exercise matches "${term}" — check the name in \`week\` or the catalogue`);
  const describe = (c: CatalogueRow) => {
    const bits = [c.category ? `category ${c.category}` : null, c.library_id ? `library ${libraryName.get(c.library_id) ?? c.library_id}` : null,
      preferIds.has(c.id) ? 'used by this coach' : null, c.is_archived ? 'archived' : null].filter(Boolean);
    return `  ${c.id}  ${c.name}  (${bits.join('; ')})`;
  };
  throw new UsageError(`"${term}" is ambiguous — pass the id:\n` + pick.candidates.map(describe).join('\n'));
}

async function cmdNewWeek(ctx: Ctx, v: Args): Promise<void> {
  const athlete = await resolveAthlete(ctx.client, v.athlete);
  const weekStart = resolveWeek(v.week, 'next');
  const like = v.like ? resolveWeek(v.like, 'this') : undefined;
  const r = await ensureIndividualWeek(ctx.client, {
    athleteId: athlete.id, weekStart, likeWeekStart: like, editorCoachId: v.coach,
  });
  if (ctx.json) { console.log(JSON.stringify({ athlete, weekStart, ...r }, null, 2)); return; }
  const days = (r.weekPlan.active_days ?? []).map(d => dayName(r.weekPlan, d)).join(', ') || '(no active days)';
  if (r.created) {
    console.log(`created ${athlete.name}'s week of ${ddmm(weekStart)} — empty, days ${days}${r.rhythmFrom ? ` (structure from ${ddmm(r.rhythmFrom)})` : ''}  (week_plans.id ${r.weekPlan.id})`);
  } else {
    console.log(`${athlete.name}'s week of ${ddmm(weekStart)} already exists — days ${days}  (week_plans.id ${r.weekPlan.id}). Nothing written.`);
  }
}

async function cmdAddExercise(ctx: Ctx, v: Args): Promise<void> {
  const athlete = await resolveAthlete(ctx.client, v.athlete);
  const weekStart = resolveWeek(v.week, 'next');
  const dayArg = v.day?.[0];
  const dayNo = Number(dayArg);
  if (!dayArg || !Number.isInteger(dayNo) || dayNo < 1) throw new UsageError("--day <n> is required (the planner's slot number: D1 = 1)");
  const exercise = await resolveExercise(ctx.client, v.exercise?.[0], athlete.owner_id);
  const explicitUnit = v.unit ? resolveUnitAlias(v.unit) : null;
  if (v.unit && !explicitUnit) throw new UsageError(`unknown --unit "${v.unit}" — use kg | % | rpe | free | free-reps | other`);
  const prescription = v.prescription?.trim() || null;
  const unit = chooseUnit(explicitUnit, prescription, exercise.default_unit as DefaultUnit);
  const position = v.position != null ? Number(v.position) : null;
  if (position != null && (!Number.isInteger(position) || position < 1)) throw new UsageError('--position must be a positive integer');

  const plan = await findIndividualPlan(ctx.client, athlete.id, weekStart);
  if (!plan) throw new UsageError(`${athlete.name} has no individual plan in the week of ${ddmm(weekStart)} — run new-week or copy-week first`);

  const r = await addPlannedExercise(ctx.client, {
    weekPlanId: plan.id, dayIndex: dayNo, exerciseId: exercise.id, unit, prescription,
    notes: v.note ?? null, displayName: v['display-name'] ?? null, position,
  });
  if (ctx.json) { console.log(JSON.stringify({ athlete, weekStart, weekPlanId: plan.id, exercise: { id: exercise.id, name: exercise.name }, unit, prescription, ...r }, null, 2)); return; }
  console.log(`added ${athlete.name} ${ddmm(weekStart)} ${dayName(plan, dayNo)} #${r.position}: ${v['display-name'] ?? exercise.name}  [${unit}]  ${prescription ?? '(empty)'}${v.note ? `  — ${v.note}` : ''}`);
  if (r.dayActivated) console.log(`note: ${dayName(plan, dayNo)} was not an active slot on this week — switched it on.`);
  console.log(`planned_exercises.id ${r.plannedExerciseId}`);
}

async function cmdAddCombo(ctx: Ctx, v: Args): Promise<void> {
  const athlete = await resolveAthlete(ctx.client, v.athlete);
  const weekStart = resolveWeek(v.week, 'next');
  const dayArg = v.day?.[0];
  const dayNo = Number(dayArg);
  if (!dayArg || !Number.isInteger(dayNo) || dayNo < 1) throw new UsageError("--day <n> is required (the planner's slot number: D1 = 1)");
  const terms = v.exercise ?? [];
  if (terms.length < 2) throw new UsageError('a combo needs --exercise <name|id> at least twice, in lifting order (e.g. --exercise Clean --exercise "Front Squat")');
  const members: CatalogueRow[] = [];
  for (const term of terms) members.push(await resolveExercise(ctx.client, term, athlete.owner_id));
  const explicitUnit = v.unit ? resolveUnitAlias(v.unit) : null;
  if (v.unit && !explicitUnit) throw new UsageError(`unknown --unit "${v.unit}" — use kg | % | rpe | free | free-reps | other`);
  const prescription = v.prescription?.trim() || null;
  if (prescription) {
    const check = checkComboPrescription(prescription);
    if (!check.ok) throw new UsageError(check.reason);
    if (check.arity !== members.length) {
      log(`note: the reps tuple names ${check.arity} lift${check.arity === 1 ? '' : 's'} per set but the combo has ${members.length} members — the planner allows it; check it is what you meant.`);
    }
  }
  const unit = chooseUnit(explicitUnit, prescription, members[0].default_unit as DefaultUnit);
  const position = v.position != null ? Number(v.position) : null;
  if (position != null && (!Number.isInteger(position) || position < 1)) throw new UsageError('--position must be a positive integer');
  if (v.color && !/^#[0-9a-f]{6}$/i.test(v.color)) throw new UsageError(`--color must be a hex colour like #3B82F6 (got "${v.color}")`);

  const plan = await findIndividualPlan(ctx.client, athlete.id, weekStart);
  if (!plan) throw new UsageError(`${athlete.name} has no individual plan in the week of ${ddmm(weekStart)} — run new-week or copy-week first`);

  const r = await addPlannedCombo(ctx.client, {
    weekPlanId: plan.id, dayIndex: dayNo,
    members: members.map(m => ({ exerciseId: m.id, name: m.name })),
    unit, prescription, notation: v.name ?? null, color: v.color ?? null, notes: v.note ?? null, position,
  });
  if (ctx.json) {
    console.log(JSON.stringify({ athlete, weekStart, weekPlanId: plan.id, members: members.map(m => ({ id: m.id, name: m.name })), unit, prescription, ...r }, null, 2));
    return;
  }
  console.log(`added ${athlete.name} ${ddmm(weekStart)} ${dayName(plan, dayNo)} #${r.position}: ${r.notation} [combo]  [${unit}]  ${prescription ?? '(empty)'}${v.note ? `  — ${v.note}` : ''}`);
  console.log(`members: ${members.map((m, i) => `${i + 1}. ${m.name}`).join('  ')}`);
  if (r.dayActivated) console.log(`note: ${dayName(plan, dayNo)} was not an active slot on this week — switched it on.`);
  console.log(`planned_exercises.id ${r.plannedExerciseId}`);
}

function requireRowId(v: Args): string {
  const id = v.id?.[0];
  if (!id || !UUID_RE.test(id)) throw new UsageError('--id <planned_exercise_id> is required (the Id column of `week`, or what add-exercise printed)');
  return id;
}

async function cmdEditExercise(ctx: Ctx, v: Args): Promise<void> {
  const id = requireRowId(v);
  const explicitUnit = v.unit ? resolveUnitAlias(v.unit) : null;
  if (v.unit && !explicitUnit) throw new UsageError(`unknown --unit "${v.unit}" — use kg | % | rpe | free | free-reps | other`);
  if (v.note != null && v['clear-note']) throw new UsageError('give --note or --clear-note, not both');
  const flags = parseFeatureFlags({ time: v.time, rest: v.rest, tempo: v.tempo, totalReps: v['total-reps'], totalSets: v['total-sets'] });
  if (!flags.ok) throw new UsageError(flags.reason);
  const hasFeatures = Object.keys(flags.patch).length > 0;
  const anything = v.prescription != null || explicitUnit || v.note != null || v['clear-note'] || v['display-name'] != null || hasFeatures;
  if (!anything) throw new UsageError('nothing to change — give --prescription, --unit, --note / --clear-note, --display-name, --time, --rest, --tempo, --total-reps or --total-sets');

  const r = await editPlannedExercise(ctx.client, {
    plannedExerciseId: id,
    prescription: v.prescription,
    unit: explicitUnit,
    notes: v['clear-note'] ? null : v.note,
    displayName: v['display-name'],
    features: hasFeatures ? flags.patch : undefined,
  });
  if (ctx.json) { console.log(JSON.stringify(r, null, 2)); return; }
  if (r.changed.length === 0) { console.log(`row ${id}: nothing changed.`); return; }
  const bits = [`[${r.unit ?? '-'}]`, r.prescription ?? '(empty)'];
  if (r.features?.totalTime) bits.push(`⏱${formatSeconds(r.features.totalTime)}`);
  if (r.features?.restTime) bits.push(`⏸${formatSeconds(r.features.restTime)}`);
  if (r.features?.tempo) bits.push(`tempo ${r.features.tempo}`);
  if (r.features?.totalReps != null) bits.push(`Σ${r.features.totalReps} reps`);
  if (r.features?.totalSets != null) bits.push(`${r.features.totalSets} sets`);
  console.log(`edited ${r.changed.join(', ')} on row ${id}: ${bits.join('  ')}`);
}

async function cmdSwapExercise(ctx: Ctx, v: Args): Promise<void> {
  const id = requireRowId(v);
  const { data: row } = await ctx.client
    .from('planned_exercises')
    .select('weekplan_id, week_plans!inner(owner_id)')
    .eq('id', id)
    .maybeSingle();
  if (!row) throw new UsageError(`no planned row with id ${id}`);
  const ownerId = (row as unknown as { week_plans: { owner_id: string } }).week_plans.owner_id;
  const exercise = await resolveExercise(ctx.client, v.exercise?.[0], ownerId);
  const r = await swapPlannedExercise(ctx.client, id, exercise.id);
  const { data: from } = await ctx.client.from('exercises').select('name').eq('id', r.from).maybeSingle();
  const fromName = (from as { name: string } | null)?.name ?? r.from;
  if (ctx.json) { console.log(JSON.stringify({ ...r, fromName, toName: exercise.name }, null, 2)); return; }
  console.log(`swapped row ${id}: ${fromName} → ${exercise.name}  (prescription, note and position kept)`);
}

async function cmdMoveExercise(ctx: Ctx, v: Args): Promise<void> {
  const id = requireRowId(v);
  const day = v.day?.[0] != null ? Number(v.day[0]) : null;
  if (day != null && (!Number.isInteger(day) || day < 1)) throw new UsageError("--day takes the planner's slot number, D1 = 1");
  const position = v.position != null ? Number(v.position) : null;
  if (position != null && (!Number.isInteger(position) || position < 1)) throw new UsageError('--position must be a positive integer');
  if (day == null && position == null) throw new UsageError('give --day <n> and/or --position <n>');
  const r = await movePlannedExercise(ctx.client, { plannedExerciseId: id, dayIndex: day, position });
  if (ctx.json) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`moved row ${id}: D${r.from.dayIndex} #${r.from.position} → D${r.to.dayIndex} #${r.to.position}`);
  if (r.dayActivated) console.log(`note: D${r.to.dayIndex} was not an active slot on this week — switched it on.`);
}

function parseGppRows(specs: string[] | undefined): GppRow[] | undefined {
  if (!specs || specs.length === 0) return undefined;
  return specs.map(spec => {
    const r = parseGppRowSpec(spec);
    if (!r.ok) throw new UsageError(r.reason);
    return r.row;
  });
}

async function cmdAddGpp(ctx: Ctx, v: Args): Promise<void> {
  const athlete = await resolveAthlete(ctx.client, v.athlete);
  const weekStart = resolveWeek(v.week, 'next');
  const dayArg = v.day?.[0];
  const dayNo = Number(dayArg);
  if (!dayArg || !Number.isInteger(dayNo) || dayNo < 1) throw new UsageError("--day <n> is required (the planner's slot number: D1 = 1)");
  const title = v.title?.trim();
  if (!title) throw new UsageError('--title "..." is required (the block\'s heading, e.g. "Core" or "Knæ-stabilitet")');
  const rows = parseGppRows(v.row) ?? [];
  const position = v.position != null ? Number(v.position) : null;
  if (position != null && (!Number.isInteger(position) || position < 1)) throw new UsageError('--position must be a positive integer');
  const plan = await findIndividualPlan(ctx.client, athlete.id, weekStart);
  if (!plan) throw new UsageError(`${athlete.name} has no individual plan in the week of ${ddmm(weekStart)} — run new-week or copy-week first`);

  const r = await addGppBlock(ctx.client, {
    weekPlanId: plan.id, dayIndex: dayNo, ownerId: athlete.owner_id, position,
    gpp: { title, description: v.description?.trim() ?? '', rows },
  });
  if (ctx.json) { console.log(JSON.stringify({ athlete, weekStart, weekPlanId: plan.id, title, rows, ...r }, null, 2)); return; }
  console.log(`added ${athlete.name} ${ddmm(weekStart)} ${dayName(plan, dayNo)} #${r.position}: GPP "${title}" — ${rows.length ? rows.map(gppRowText).join(' · ') : '(no rows yet)'}`);
  if (r.sentinelCreated) console.log('note: created the coach\'s GPP sentinel exercise (first GPP block for this coach).');
  if (r.dayActivated) console.log(`note: ${dayName(plan, dayNo)} was not an active slot on this week — switched it on.`);
  console.log(`planned_exercises.id ${r.plannedExerciseId}`);
}

async function cmdEditGpp(ctx: Ctx, v: Args): Promise<void> {
  const id = requireRowId(v);
  const rows = parseGppRows(v.row);
  if (v.title == null && v.description == null && !rows) throw new UsageError('give --title, --description and/or --row (rows replace the block\'s rows)');
  const r = await editGppBlock(ctx.client, { plannedExerciseId: id, title: v.title?.trim(), description: v.description, rows });
  if (ctx.json) { console.log(JSON.stringify(r, null, 2)); return; }
  if (r.changed.length === 0) { console.log(`row ${id}: nothing changed.`); return; }
  console.log(`edited ${r.changed.join(', ')} on GPP "${r.gpp.title}" (${id}): ${r.gpp.rows.map(gppRowText).join(' · ') || '(no rows)'}`);
}

async function cmdLog(ctx: Ctx, v: Args): Promise<void> {
  const athlete = await resolveAthlete(ctx.client, v.athlete);
  const weekStart = resolveWeek(v.week, 'this');
  type Session = {
    id: string; date: string; day_index: number; status: string | null; session_rpe: number | null;
    duration_minutes: number | null; session_notes: string | null; bodyweight_kg: number | null; coach_reviewed_at: string | null;
  };
  const { data: sRows, error: sErr } = await ctx.client
    .from('training_log_sessions')
    .select('id, date, day_index, status, session_rpe, duration_minutes, session_notes, bodyweight_kg, coach_reviewed_at')
    .eq('athlete_id', athlete.id)
    .eq('week_start', weekStart)
    .order('day_index');
  if (sErr) throw sErr;
  const sessions = (sRows as unknown as Session[]) ?? [];
  if (sessions.length === 0) {
    if (ctx.json) { console.log(JSON.stringify({ athlete, weekStart, sessions: [] })); return; }
    console.log(`${athlete.name} — week of ${ddmm(weekStart)}: nothing logged`);
    return;
  }
  type LogEx = {
    id: string; session_id: string; exercise_id: string | null; planned_exercise_id: string | null; performed_raw: string | null;
    performed_notes: string | null; position: number; status: string | null; technique_rating: number | null;
    metadata: { gpp?: { title: string; rows: (GppRow & { done?: boolean })[] } } | null;
  };
  type LogSet = { log_exercise_id: string; set_number: number; performed_load: number | null; performed_reps: number | null; performed_text: string | null; rpe: number | null; status: string | null };
  const { data: exRows, error: eErr } = await ctx.client
    .from('training_log_exercises')
    .select('id, session_id, exercise_id, planned_exercise_id, performed_raw, performed_notes, position, status, technique_rating, metadata')
    .in('session_id', sessions.map(s => s.id))
    .order('position');
  if (eErr) throw eErr;
  const exs = (exRows as unknown as LogEx[]) ?? [];
  const exIds = exs.map(e => e.id);
  const sets: LogSet[] = exIds.length
    ? (((await ctx.client.from('training_log_sets').select('log_exercise_id, set_number, performed_load, performed_reps, performed_text, rpe, status').in('log_exercise_id', exIds).order('set_number')).data as unknown as LogSet[]) ?? [])
    : [];
  const plannedIds = exs.map(e => e.planned_exercise_id).filter((x): x is string => !!x);
  const planned = new Map<string, { prescription_raw: string | null; display_name: string | null; combo_notation: string | null; is_combo: boolean }>();
  if (plannedIds.length) {
    const { data } = await ctx.client.from('planned_exercises').select('id, prescription_raw, display_name, combo_notation, is_combo').in('id', plannedIds);
    for (const r of (data as unknown as { id: string; prescription_raw: string | null; display_name: string | null; combo_notation: string | null; is_combo: boolean }[]) ?? []) planned.set(r.id, r);
  }
  const { rows: catalogue } = await loadCatalogue(ctx.client);
  const nameOf = new Map(catalogue.map(c => [c.id, c.name]));
  const num = (n: number | null) => n == null ? '' : String(n).replace('.', ',');
  const setText = (s: LogSet) => s.performed_text ?? (s.performed_load != null || s.performed_reps != null ? `${num(s.performed_load)}×${num(s.performed_reps)}` : '') + (s.rpe != null ? `@${num(s.rpe)}` : '');

  const out = sessions.map(s => ({
    ...s,
    exercises: exs.filter(e => e.session_id === s.id).map(e => {
      const p = e.planned_exercise_id ? planned.get(e.planned_exercise_id) : undefined;
      const gpp = e.metadata?.gpp;
      const label = gpp ? `GPP: ${gpp.title}` : p?.display_name ?? (p?.is_combo ? p.combo_notation : null) ?? (e.exercise_id ? nameOf.get(e.exercise_id) : null) ?? '(off plan)';
      const done = gpp ? `${gpp.rows.filter(r => r.done).length}/${gpp.rows.length} ticked` : null;
      const exSets = sets.filter(x => x.log_exercise_id === e.id);
      return {
        id: e.id, label, status: e.status, planned: p?.prescription_raw ?? null,
        performed: done ?? e.performed_raw ?? exSets.map(setText).filter(Boolean).join(', '),
        rating: e.technique_rating, notes: e.performed_notes, sets: exSets,
      };
    }),
  }));
  if (ctx.json) { console.log(JSON.stringify({ athlete, weekStart, sessions: out }, null, 2)); return; }
  console.log(`${athlete.name} — logged week of ${ddmm(weekStart)}`);
  for (const s of out) {
    const head = [`D${s.day_index} ${ddmm(s.date)}`, s.status ?? '', s.session_rpe != null ? `RPE ${num(s.session_rpe)}` : '', s.duration_minutes != null ? `${s.duration_minutes} min` : '', s.bodyweight_kg != null ? `BW ${num(s.bodyweight_kg)}` : '', s.coach_reviewed_at ? 'reviewed' : 'NOT reviewed'].filter(Boolean).join('  ');
    console.log(`\n${head}${s.session_notes ? `\n  athlete: ${oneLine(s.session_notes)}` : ''}`);
    if (s.exercises.length === 0) { console.log('  (no exercises logged)'); continue; }
    console.log(table(
      s.exercises.map(e => [e.label, e.status ?? '', e.planned ?? '', e.performed, e.rating != null ? String(e.rating) : '', oneLine(e.notes)]),
      ['Exercise', 'Status', 'Planned', 'Performed', 'Tech', 'Athlete note'],
    ).split('\n').map(l => '  ' + l).join('\n'));
  }
}

async function cmdRemoveExercise(ctx: Ctx, v: Args): Promise<void> {
  const id = v.id?.[0];
  if (!id || !UUID_RE.test(id)) throw new UsageError('--id <planned_exercise_id> is required (from week --json or add-exercise)');
  const r = await removePlannedExercise(ctx.client, id);
  if (ctx.json) { console.log(JSON.stringify({ id, ...r }, null, 2)); return; }
  if (!r.removed) { console.log(`no planned row with id ${id} — nothing removed.`); process.exitCode = 2; return; }
  console.log(`removed planned row ${id} (week_plans.id ${r.weekPlanId}, D${r.dayIndex}).`);
}

async function cmdPrs(ctx: Ctx, v: Args): Promise<void> {
  const athlete = await resolveAthlete(ctx.client, v.athlete);
  const { rows: catalogue } = await loadCatalogue(ctx.client);
  const nameOf = new Map(catalogue.map(c => [c.id, c.name]));
  let only: string | null = null;
  if (v.exercise?.[0]) only = (await resolveExercise(ctx.client, v.exercise[0], athlete.owner_id)).id;

  let prq = ctx.client.from('athlete_prs').select('exercise_id, pr_value_kg, pr_date').eq('athlete_id', athlete.id);
  if (only) prq = prq.eq('exercise_id', only);
  const { data: prs, error: prErr } = await prq;
  if (prErr) throw prErr;
  let hq = ctx.client.from('athlete_pr_history').select('exercise_id, rep_count, value_kg, achieved_date').eq('athlete_id', athlete.id).order('achieved_date', { ascending: false });
  if (only) hq = hq.eq('exercise_id', only);
  const { data: hist, error: hErr } = await hq;
  if (hErr) throw hErr;

  type Pr = { exercise_id: string; pr_value_kg: number | null; pr_date: string | null };
  type Hist = { exercise_id: string; rep_count: number; value_kg: number; achieved_date: string };
  const prRows = ((prs as unknown as Pr[]) ?? []).map(r => ({ ...r, exercise: nameOf.get(r.exercise_id) ?? r.exercise_id }));
  // Best per exercise × rep count, newest wins a tie.
  const best = new Map<string, Hist>();
  for (const h of (hist as unknown as Hist[]) ?? []) {
    const k = `${h.exercise_id}|${h.rep_count}`;
    if (!best.has(k) || best.get(k)!.value_kg < h.value_kg) best.set(k, h);
  }
  const histRows = [...best.values()]
    .map(h => ({ ...h, exercise: nameOf.get(h.exercise_id) ?? h.exercise_id }))
    .sort((a, b) => a.exercise.localeCompare(b.exercise) || a.rep_count - b.rep_count);

  if (ctx.json) { console.log(JSON.stringify({ athlete, prs: prRows, repMaxes: histRows }, null, 2)); return; }
  console.log(`${athlete.name} — PRs (athlete_prs: implied 1RM the planner resolves % against)`);
  console.log(prRows.length
    ? table(prRows.sort((a, b) => a.exercise.localeCompare(b.exercise)).map(r => [r.exercise, r.pr_value_kg != null ? String(r.pr_value_kg) : '', r.pr_date ? ddmm(r.pr_date) : '']), ['Exercise', '1RM kg', 'Date'])
    : '(none)');
  console.log(`\nRep maxes (athlete_pr_history, best per rep count)`);
  console.log(histRows.length
    ? table(histRows.map(h => [h.exercise, `${h.rep_count}RM`, String(h.value_kg), ddmm(h.achieved_date)]), ['Exercise', 'Reps', 'kg', 'Date'])
    : '(none)');
}

// ─── Main ────────────────────────────────────────────────────────────────────

type Args = {
  athlete?: string; week?: string; from?: string; to?: string; coach?: string;
  factor?: string; by?: string; exercise?: string[]; category?: string[]; id?: string[]; day?: string[];
  'include-combos'?: boolean; 'round-kg'?: string; 'round-pct'?: string; apply?: boolean;
  like?: string; unit?: string; prescription?: string; note?: string; 'display-name'?: string; position?: string;
  name?: string; color?: string;
  'clear-note'?: boolean; time?: string; rest?: string; tempo?: string; 'total-reps'?: string; 'total-sets'?: string;
  title?: string; description?: string; row?: string[];
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
  npm run emos -- new-week    --athlete <name|id> [--week next] [--like this|YYYY-MM-DD]
  npm run emos -- add-exercise --athlete <name|id> [--week next] --day <n> --exercise <name|id>
                              [--prescription "87.5×5, 100×5, 115×5-10"] [--unit kg|%|rpe|free|free-reps]
                              [--note "..."] [--display-name "..."] [--position <n>]
  npm run emos -- add-combo   --athlete <name|id> [--week next] --day <n> --exercise <name|id> --exercise <name|id>...
                              [--prescription "80×1+2×3"] [--unit kg|%|rpe|free|free-reps] [--name "Clean + Front Squat"]
                              [--color "#3B82F6"] [--note "..."] [--position <n>]
  npm run emos -- edit-exercise --id <planned_exercise_id> [--prescription "..."] [--unit kg|%|rpe|free|free-reps]
                              [--note "..."|--clear-note] [--display-name "..."] [--time 12|90s|2:15|off]
                              [--rest 90s|off] [--tempo 3120|off] [--total-reps <n>|off] [--total-sets <n>|off]
  npm run emos -- swap-exercise --id <planned_exercise_id> --exercise <name|id>
  npm run emos -- move-exercise --id <planned_exercise_id> [--day <n>] [--position <n>]
  npm run emos -- add-gpp     --athlete <name|id> [--week next] --day <n> --title "Core" [--description "..."]
                              --row "Wall sits | 60s | 3" [--row "Plank | 45s | 3 | BW"]... [--position <n>]
  npm run emos -- edit-gpp    --id <planned_exercise_id> [--title "..."] [--description "..."] [--row "..."]...
  npm run emos -- remove-exercise --id <planned_exercise_id>
  npm run emos -- log         --athlete <name|id> [--week this]
  npm run emos -- prs         --athlete <name|id> [--exercise <name>]
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
      like: { type: 'string' }, unit: { type: 'string' }, prescription: { type: 'string' }, note: { type: 'string' },
      'display-name': { type: 'string' }, position: { type: 'string' },
      name: { type: 'string' }, color: { type: 'string' },
      'clear-note': { type: 'boolean' }, time: { type: 'string' }, rest: { type: 'string' }, tempo: { type: 'string' },
      'total-reps': { type: 'string' }, 'total-sets': { type: 'string' },
      title: { type: 'string' }, description: { type: 'string' }, row: { type: 'string', multiple: true },
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
    case 'new-week': return cmdNewWeek(ctx, v);
    case 'add-exercise': return cmdAddExercise(ctx, v);
    case 'add-combo': return cmdAddCombo(ctx, v);
    case 'edit-exercise': return cmdEditExercise(ctx, v);
    case 'swap-exercise': return cmdSwapExercise(ctx, v);
    case 'move-exercise': return cmdMoveExercise(ctx, v);
    case 'add-gpp': return cmdAddGpp(ctx, v);
    case 'edit-gpp': return cmdEditGpp(ctx, v);
    case 'remove-exercise': return cmdRemoveExercise(ctx, v);
    case 'log': return cmdLog(ctx, v);
    case 'prs': return cmdPrs(ctx, v);
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
