/**
 * analysisAdapter — KinEMOS results, projected for anyone who is not the viewer.
 *
 * Design §13 Q3, decided 02/09/2026: KinEMOS keeps its own tables and its own
 * metric definitions, and the Analysis module reads them through THIS file —
 * a read-only projection of stored analyses into flat records (athlete,
 * exercise, date, one value per catalogue metric, the grade as a quality flag).
 * Nothing here imports the Analysis module and nothing in the Analysis module
 * imports the engine; both import this.
 *
 * Two facts about the data shape this projection has to bridge:
 *
 *   - **An analysis has no athlete.** It names its clip polymorphically
 *     (`source_kind`, `source_id`) and the athlete, the exercise, the date and
 *     the logged load all live on the library row for that clip. So the join is
 *     done here, in memory, over the two full reads — the same trade the
 *     comparison picker makes and for the same reason.
 *   - **The metrics are a cache.** `kinemos_analyses.metrics` is what the viewer
 *     last derived from the track and the calibration, written under a schema
 *     number (`engine/metricCatalogue.ts`). A trend over a season reads that
 *     cache rather than re-running the pipeline on every rep; the record says
 *     which schema each row was written under so a reader can tell an older
 *     definition from a newer one instead of drawing one line through both.
 */
import type { KinemosAnalysis } from '../../lib/database.types';
import { METRIC_CATALOGUE, fromStoredMetrics } from '../engine/metricCatalogue';
import { listRecentAnalyses } from './analysisService';
import { loadLibrary, type LibrarySource, type LibraryVideo } from './videoLibrary';

/** One analysed rep, flat, with everything a chart or a fact table needs. */
export interface KinemosLiftRecord {
  analysisId: string;
  /** The library key of the clip, `log:<uuid>` etc. */
  clipKey: string;
  sourceKind: LibrarySource;
  sourceId: string;
  /** 1-based, as the coach counts reps. */
  repIndex: number;
  label: string | null;

  athleteId: string | null;
  athleteName: string | null;
  exerciseName: string | null;
  /** YYYY-MM-DD: the training or competition date where one exists, else the
   *  day the clip was recorded or imported. Null only for a clip with no date
   *  at all, which the library does not produce today. */
  date: string | null;

  /** The logged load the library shows for this clip, kg. */
  loadKg: number | null;
  /** The bar mass the analysis used for power — logged or typed. */
  massKg: number | null;
  massSource: 'logged' | 'manual' | null;

  grade: 'A' | 'B' | 'C' | null;
  /** One-sigma estimate of the error on peak velocity, m/s — the number behind
   *  the letter. */
  gradeErrorMs: number | null;
  phaseSetId: string;
  /** The athlete's reference lift for this exercise (design §8, comparison
   *  item 3). At most one per (athlete, exercise). */
  isReference: boolean;
  /** Which stored-metrics schema the values were written under. */
  schema: number;
  /** When the analysis was last saved, ISO. */
  analysedAt: string;

  /** One entry per catalogue metric id, null where the value is not there. */
  values: Record<string, number | null>;
}

/** The long form: one row per (rep, metric) with a value. What the design calls
 *  an Analysis fact. */
export interface KinemosFact {
  analysisId: string;
  athleteId: string;
  exerciseName: string | null;
  date: string;
  metricId: string;
  value: number;
  unit: string;
  grade: 'A' | 'B' | 'C' | null;
}

/**
 * Join stored analyses to their library rows and read each one's cached
 * metrics. Pure — the reads happen in `loadKinemosLiftRecords`.
 *
 * An analysis whose clip is no longer in the library is dropped: without the
 * row there is no athlete, no exercise and no date, so nothing to trend. An
 * analysis with no cached metrics is KEPT, with every value null — it is still
 * a rep the coach analysed, and a trend view may want to say "3 of 12 reps
 * have no numbers yet" rather than silently show 9.
 */
export function projectLiftRecords(
  analyses: readonly KinemosAnalysis[],
  library: readonly LibraryVideo[],
): KinemosLiftRecord[] {
  const byKey = new Map(library.map(v => [v.key, v]));
  const out: KinemosLiftRecord[] = [];

  for (const analysis of analyses) {
    const clipKey = `${analysis.source_kind}:${analysis.source_id}`;
    const clip = byKey.get(clipKey);
    if (!clip) continue;

    const stored = fromStoredMetrics(analysis.metrics);
    const values: Record<string, number | null> = {};
    for (const metric of METRIC_CATALOGUE) {
      values[metric.id] = stored ? metric.read({ metrics: stored, summary: stored.summary }) : null;
    }

    out.push({
      analysisId: analysis.id,
      clipKey,
      sourceKind: analysis.source_kind,
      sourceId: analysis.source_id,
      repIndex: analysis.rep_index,
      label: analysis.label,
      athleteId: clip.athleteId,
      athleteName: clip.athleteName,
      exerciseName: clip.exerciseName,
      date: clip.date,
      loadKg: clip.loadKg,
      massKg: analysis.mass_kg === null ? null : Number(analysis.mass_kg),
      massSource: analysis.mass_source,
      grade: analysis.grade,
      gradeErrorMs: analysis.grade_error_ms === null ? null : Number(analysis.grade_error_ms),
      phaseSetId: analysis.phase_set_id,
      isReference: analysis.is_reference === true,
      schema: stored?.schema ?? 0,
      analysedAt: analysis.updated_at,
      values,
    });
  }

  // Oldest first — a trend reads left to right — with the rep order as the
  // tiebreak so two reps of one set keep their numbering.
  return out.sort((a, b) => {
    const byDate = (a.date ?? '').localeCompare(b.date ?? '');
    if (byDate !== 0) return byDate;
    return a.repIndex - b.repIndex;
  });
}

/**
 * Flatten records into (rep, metric, value) facts. Records with no athlete or
 * no date cannot be placed on an Analysis axis and are left out.
 */
export function factsFrom(records: readonly KinemosLiftRecord[]): KinemosFact[] {
  const unitOf = new Map(METRIC_CATALOGUE.map(m => [m.id, m.unit]));
  const facts: KinemosFact[] = [];
  for (const r of records) {
    if (!r.athleteId || !r.date) continue;
    for (const [metricId, value] of Object.entries(r.values)) {
      if (value === null) continue;
      facts.push({
        analysisId: r.analysisId,
        athleteId: r.athleteId,
        exerciseName: r.exerciseName,
        date: r.date,
        metricId,
        value,
        unit: unitOf.get(metricId) ?? '',
        grade: r.grade,
      });
    }
  }
  return facts;
}

export interface LiftRecordFilters {
  /** Keep only these athletes. Omit for everyone. */
  athleteIds?: readonly string[];
  /** Inclusive YYYY-MM-DD bounds on the record's date. */
  from?: string;
  to?: string;
}

/** Apply the filters a caller would otherwise have to write three times. */
export function filterLiftRecords(
  records: readonly KinemosLiftRecord[],
  filters: LiftRecordFilters,
): KinemosLiftRecord[] {
  const athletes = filters.athleteIds ? new Set(filters.athleteIds) : null;
  return records.filter(r => {
    if (athletes && (!r.athleteId || !athletes.has(r.athleteId))) return false;
    if ((filters.from || filters.to) && !r.date) return false;
    if (filters.from && r.date! < filters.from) return false;
    if (filters.to && r.date! > filters.to) return false;
    return true;
  });
}

/**
 * Every analysed rep the account has, joined and filtered.
 *
 * Two full reads, as the library and the comparison picker do; fine at a season
 * of footage, and keyset pagination on `updated_at` is the fix when it is not.
 */
export async function loadKinemosLiftRecords(
  filters: LiftRecordFilters = {},
): Promise<KinemosLiftRecord[]> {
  const [analyses, library] = await Promise.all([listRecentAnalyses(), loadLibrary()]);
  return filterLiftRecords(projectLiftRecords(analyses, library), filters);
}
