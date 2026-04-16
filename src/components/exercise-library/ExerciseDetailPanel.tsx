import { useState, useEffect } from 'react';
import { X, ExternalLink, Edit2, Archive, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { estimate1RM, estimateWeightAtReps, roundToHalf } from '../../lib/xrmUtils';
import type { Exercise, Athlete } from '../../lib/database.types';
import type { Category } from '../../hooks/useExercises';
import { Button, ColorDot, Textarea } from '../ui';

// ── Types ──────────────────────────────────────────────────────────

interface AthletePRRow {
  id: string;
  athlete_id: string;
  exercise_id: string;
  pr_value_kg: number | null;
  pr_date: string | null;
  athleteName: string;
  athleteInitials: string;
}

interface UsageWeek {
  weekStart: string;
  dayIndex: number;
}

interface ExerciseDetailPanelProps {
  exercise: Exercise;
  category: Category | null;
  athlete: Athlete | null;
  allAthletes: Athlete[];
  onClose: () => void;
  onEdit: (exercise: Exercise) => void;
  onArchive: (exerciseId: string) => void;
  onSelectExercise: (exerciseId: string) => void;
  relatedExercises: Exercise[];
  allExercises: Exercise[];
}

// ── Helpers ────────────────────────────────────────────────────────

const UNIT_DISPLAY: Record<string, string> = {
  absolute_kg: 'kg',
  percentage: '%',
  rpe: 'RPE',
  free_text: 'Free text',
  free_text_reps: 'Reps',
  other: 'Other',
};

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Section label ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 'var(--text-label)',
      fontWeight: 600,
      color: 'var(--color-text-tertiary)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 'var(--space-sm)',
    }}>
      {children}
    </div>
  );
}

// ── xRM Table Modal ────────────────────────────────────────────────

function XrmTableModal({ oneRM, prHistory, exerciseName, onClose }: {
  oneRM: number | null;
  prHistory: Map<number, number>;
  exerciseName: string;
  onClose: () => void;
}) {
  // Merge athlete_prs 1RM into the history map (history wins if it has a 1RM entry)
  const actualPRs = new Map(prHistory);
  if (oneRM !== null && !actualPRs.has(1)) {
    actualPRs.set(1, oneRM);
  }

  // Reference 1RM for percentage bars
  let ref1RM = 1;
  if (actualPRs.has(1)) {
    ref1RM = actualPRs.get(1)!;
  } else if (actualPRs.size > 0) {
    ref1RM = Math.max(...[...actualPRs.entries()].map(([rep, kg]) => estimate1RM(kg, rep)));
  }

  const actualRepsSorted = [...actualPRs.keys()].sort((a, b) => a - b);

  const rows = Array.from({ length: 10 }, (_, i) => {
    const reps = i + 1;

    if (actualPRs.has(reps)) {
      const weight = actualPRs.get(reps)!;
      const pct = Math.round((weight / ref1RM) * 100);
      return { reps, weight, pct, isActual: true };
    }

    // Theoretical: use nearest actual PR(s) as reference
    const minDist = Math.min(...actualRepsSorted.map(r => Math.abs(r - reps)));
    const nearest = actualRepsSorted.filter(r => Math.abs(r - reps) === minDist);
    const estimates = nearest.map(refRep => {
      const implied1RM = estimate1RM(actualPRs.get(refRep)!, refRep);
      return estimateWeightAtReps(implied1RM, reps);
    });
    const weight = roundToHalf(estimates.reduce((a, b) => a + b, 0) / estimates.length);
    const pct = Math.round((weight / ref1RM) * 100);
    return { reps, weight, pct, isActual: false };
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 'var(--space-md)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg-primary)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
          width: 288,
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '0.5px solid var(--color-border-tertiary)',
        }}>
          <div>
            <div style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              xRM Table
            </div>
            <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {exerciseName} · 1RM ≈ {Math.round(ref1RM)} kg
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              color: 'var(--color-text-tertiary)',
              padding: 4,
              borderRadius: 'var(--radius-sm)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Rows */}
        <div style={{ padding: '8px 16px' }}>
          {rows.map(({ reps, weight, pct, isActual }, i) => (
            <div
              key={reps}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderBottom: i < rows.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none',
              }}
            >
              <div style={{
                width: 32,
                fontSize: 'var(--text-caption)',
                fontWeight: isActual ? 700 : 400,
                fontStyle: isActual ? 'normal' : 'italic',
                color: isActual ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}>
                {reps}RM
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  height: 6,
                  borderRadius: 3,
                  width: `${pct}%`,
                  background: isActual ? 'var(--color-accent)' : 'var(--color-info-border)',
                  opacity: isActual ? 1 : 0.5,
                }} />
              </div>
              <div style={{
                fontSize: 'var(--text-caption)',
                fontWeight: isActual ? 700 : 400,
                fontStyle: isActual ? 'normal' : 'italic',
                color: isActual ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                width: 56,
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
              }}>
                {weight} kg
              </div>
              <div style={{
                fontSize: 9,
                color: 'var(--color-text-tertiary)',
                width: 32,
                textAlign: 'right',
              }}>
                {pct}%
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Usage History Chart ────────────────────────────────────────────

function UsageHistoryChart({ weeks }: { weeks: UsageWeek[] }) {
  if (weeks.length === 0) {
    return (
      <div style={{
        fontSize: 'var(--text-label)',
        color: 'var(--color-text-tertiary)',
        fontStyle: 'italic',
        padding: '8px 0',
      }}>
        No usage history found.
      </div>
    );
  }

  const sorted = [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const uniqueWeeks = [...new Set(sorted.map(w => w.weekStart))].slice(-24);

  const countMap = new Map<string, number>();
  for (const w of weeks) {
    countMap.set(w.weekStart, (countMap.get(w.weekStart) ?? 0) + 1);
  }

  const maxCount = Math.max(...uniqueWeeks.map(ws => countMap.get(ws) ?? 0), 1);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 40, marginTop: 4 }}>
        {uniqueWeeks.map(ws => {
          const count = countMap.get(ws) ?? 0;
          const h = (count / maxCount) * 100;
          return (
            <div
              key={ws}
              style={{
                flex: 1,
                borderRadius: '2px 2px 0 0',
                minWidth: 0,
                height: `${Math.max(h, 8)}%`,
                background: 'var(--color-info-border)',
                opacity: 0.8,
              }}
              title={`${formatWeekLabel(ws)}: ${count} session${count !== 1 ? 's' : ''}`}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 8, color: 'var(--color-text-tertiary)' }}>{formatWeekLabel(uniqueWeeks[0])}</span>
        <span style={{ fontSize: 8, color: 'var(--color-text-tertiary)' }}>{formatWeekLabel(uniqueWeeks[uniqueWeeks.length - 1])}</span>
      </div>
      <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
        {uniqueWeeks.length} weeks · {weeks.length} total sessions
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────

export function ExerciseDetailPanel({
  exercise,
  category,
  athlete,
  allAthletes,
  onClose,
  onEdit,
  onArchive,
  onSelectExercise,
  relatedExercises,
  allExercises,
}: ExerciseDetailPanelProps) {
  const [athletePRs, setAthletePRs] = useState<AthletePRRow[]>([]);
  const [prHistory, setPrHistory] = useState<Map<number, number>>(new Map());
  const [usageWeeks, setUsageWeeks] = useState<UsageWeek[]>([]);
  const [athleteCount, setAthleteCount] = useState<number>(0);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(exercise.notes ?? '');
  const [loadingData, setLoadingData] = useState(true);
  const [showXrmModal, setShowXrmModal] = useState(false);
  const [prCardHover, setPrCardHover] = useState(false);

  const prRefExercise = exercise.pr_reference_exercise_id
    ? allExercises.find(e => e.id === exercise.pr_reference_exercise_id)
    : null;

  useEffect(() => {
    setNotesValue(exercise.notes ?? '');
    setShowXrmModal(false);
    loadData();
  }, [exercise.id, athlete?.id]);

  async function loadData() {
    setLoadingData(true);
    try {
      await Promise.all([loadPRs(), loadUsage()]);
    } finally {
      setLoadingData(false);
    }
  }

  async function loadPRs() {
    if (athlete) {
      const [{ data }, { data: histData }] = await Promise.all([
        supabase
          .from('athlete_prs')
          .select('*')
          .eq('athlete_id', athlete.id)
          .eq('exercise_id', exercise.id)
          .limit(1),
        supabase
          .from('athlete_pr_history')
          .select('rep_count, value_kg')
          .eq('athlete_id', athlete.id)
          .eq('exercise_id', exercise.id),
      ]);
      setAthletePRs((data || []).map(r => ({
        ...r,
        athleteName: athlete.name,
        athleteInitials: initials(athlete.name),
      })));
      // Build best-per-rep map from history
      const bestByRep = new Map<number, number>();
      for (const r of (histData || []) as { rep_count: number; value_kg: number }[]) {
        const prev = bestByRep.get(r.rep_count) ?? 0;
        if (r.value_kg > prev) bestByRep.set(r.rep_count, r.value_kg);
      }
      setPrHistory(bestByRep);
    } else {
      const { data } = await supabase
        .from('athlete_prs')
        .select('*')
        .eq('exercise_id', exercise.id)
        .eq('owner_id', getOwnerId())
        .order('pr_value_kg', { ascending: false });
      const athleteMap = new Map(allAthletes.map(a => [a.id, a]));
      const rows: AthletePRRow[] = (data || [])
        .filter((r: any) => r.pr_value_kg !== null)
        .map((r: any) => {
          const a = athleteMap.get(r.athlete_id);
          return {
            ...r,
            athleteName: a?.name ?? 'Unknown',
            athleteInitials: a ? initials(a.name) : '?',
          };
        })
        .sort((a: AthletePRRow, b: AthletePRRow) => (b.pr_value_kg ?? 0) - (a.pr_value_kg ?? 0));
      setAthletePRs(rows);

      const uniqueAthletes = new Set(rows.map(r => r.athlete_id));
      setAthleteCount(uniqueAthletes.size);
    }
  }

  async function loadUsage() {
    const { data } = await supabase
      .from('planned_exercises')
      .select('day_index, week_plans(week_start, athlete_id)')
      .eq('exercise_id', exercise.id);

    const weeks: UsageWeek[] = [];
    for (const r of (data || []) as any[]) {
      const wp = r.week_plans;
      if (!wp) continue;
      if (athlete && wp.athlete_id !== athlete.id) continue;
      weeks.push({ weekStart: wp.week_start, dayIndex: r.day_index ?? 0 });
    }
    setUsageWeeks(weeks);
  }

  async function saveNotes() {
    setEditingNotes(false);
    if (notesValue === (exercise.notes ?? '')) return;
    await supabase.from('exercises').update({ notes: notesValue || null }).eq('id', exercise.id);
  }

  const currentPR = athlete ? athletePRs[0] : null;
  const maxPR = Math.max(...athletePRs.map(r => r.pr_value_kg ?? 0), 1);
  const hasPR = currentPR?.pr_value_kg != null || prHistory.size > 0;

  const catName = exercise.category as unknown as string;
  const unitLabel = UNIT_DISPLAY[exercise.default_unit as string] ?? exercise.default_unit ?? 'kg';

  const propRows: { label: string; value: string; mono?: boolean; valueColor?: string }[] = [
    { label: 'Category', value: category?.name ?? catName ?? '—' },
    { label: 'Default unit', value: unitLabel },
    {
      label: 'Track PR',
      value: exercise.track_pr ? 'Yes' : 'No',
      valueColor: exercise.track_pr ? 'var(--color-info-text)' : 'var(--color-text-tertiary)',
    },
    {
      label: 'Counts towards totals',
      value: exercise.counts_towards_totals ? 'Yes' : 'No',
      valueColor: exercise.counts_towards_totals ? 'var(--color-success-text)' : 'var(--color-text-tertiary)',
    },
    {
      label: 'Competition lift',
      value: exercise.is_competition_lift ? 'Yes' : 'No',
      valueColor: exercise.is_competition_lift ? 'var(--color-danger-text)' : 'var(--color-text-tertiary)',
    },
    ...(exercise.exercise_code ? [{ label: 'Code', value: exercise.exercise_code, mono: true }] : []),
    ...(prRefExercise ? [{ label: '% derived from', value: prRefExercise.name }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        flexShrink: 0,
      }}>
        <ColorDot size={12} color={exercise.color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--text-body)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {exercise.name}
          </div>
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
            {exercise.exercise_code && (
              <span style={{ fontFamily: 'var(--font-mono)' }}>{exercise.exercise_code} · </span>
            )}
            {catName}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            color: 'var(--color-text-tertiary)',
            padding: 4,
            borderRadius: 'var(--radius-sm)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>

        {/* Properties table */}
        <div style={{
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          {propRows.map(({ label, value, mono, valueColor }, i) => (
            <div
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 12px',
                background: i % 2 === 0 ? 'var(--color-bg-secondary)' : 'var(--color-bg-primary)',
              }}
            >
              <span style={{
                width: 148,
                flexShrink: 0,
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-tertiary)',
              }}>
                {label}
              </span>
              <span style={{
                fontSize: 'var(--text-caption)',
                fontWeight: 500,
                color: valueColor ?? 'var(--color-text-primary)',
                fontFamily: mono ? 'var(--font-mono)' : undefined,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* ── Athlete view ──────────────────────────────────────── */}
        {athlete ? (
          <>
            {/* Current PR — clickable to open xRM table */}
            <div>
              <SectionLabel>Personal Record</SectionLabel>
              <button
                onClick={() => hasPR && setShowXrmModal(true)}
                disabled={!hasPR}
                onMouseEnter={() => hasPR && setPrCardHover(true)}
                onMouseLeave={() => setPrCardHover(false)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: 16,
                  borderRadius: 'var(--radius-lg)',
                  border: `2px solid ${hasPR ? 'var(--color-info-border)' : 'var(--color-border-tertiary)'}`,
                  background: hasPR
                    ? (prCardHover ? 'var(--color-info-bg)' : 'var(--color-info-bg)')
                    : 'var(--color-bg-secondary)',
                  cursor: hasPR ? 'pointer' : 'default',
                  transition: 'background 100ms ease-out',
                  opacity: hasPR && prCardHover ? 0.85 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{
                      fontSize: 30,
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      color: hasPR ? 'var(--color-info-text)' : 'var(--color-text-tertiary)',
                      lineHeight: 1,
                    }}>
                      {hasPR ? `${currentPR!.pr_value_kg}` : '—'}
                      {hasPR && (
                        <span style={{
                          fontSize: 'var(--text-body)',
                          fontWeight: 500,
                          marginLeft: 4,
                          color: 'var(--color-info-border)',
                        }}>
                          kg
                        </span>
                      )}
                    </div>
                    {currentPR?.pr_date && (
                      <div style={{
                        fontSize: 'var(--text-label)',
                        color: 'var(--color-info-text)',
                        marginTop: 2,
                        opacity: 0.7,
                      }}>
                        {formatDate(currentPR.pr_date)}
                      </div>
                    )}
                  </div>
                  {hasPR && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 'var(--text-label)',
                      color: 'var(--color-info-text)',
                      opacity: 0.7,
                    }}>
                      <span>xRM table</span>
                      <ChevronRight size={12} />
                    </div>
                  )}
                </div>
              </button>
            </div>

            {/* Usage history chart */}
            <div>
              <SectionLabel>Usage history</SectionLabel>
              {loadingData ? (
                <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)' }}>Loading…</div>
              ) : (
                <UsageHistoryChart weeks={usageWeeks} />
              )}
            </div>
          </>
        ) : (
          /* ── Coach view ────────────────────────────────────────── */
          <>
            {/* Roster stats */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              padding: 14,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-tertiary)',
                  marginBottom: 4,
                }}>
                  Athletes with a PR
                </div>
                <div style={{
                  fontSize: 24,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: athleteCount > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {loadingData ? '—' : athleteCount}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                  of {allAthletes.filter(a => a.is_active).length} active
                </div>
                {!loadingData && athletePRs.length > 0 && (
                  <div style={{
                    fontSize: 'var(--text-label)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                    marginTop: 2,
                  }}>
                    Best: {athletePRs[0].pr_value_kg} kg
                  </div>
                )}
              </div>
            </div>

            {/* Roster PR table */}
            <div>
              <SectionLabel>Roster PRs</SectionLabel>
              {loadingData ? (
                <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)' }}>Loading…</div>
              ) : athletePRs.length === 0 ? (
                <div style={{
                  fontSize: 'var(--text-label)',
                  color: 'var(--color-text-tertiary)',
                  fontStyle: 'italic',
                  padding: '4px 0',
                }}>
                  No PRs recorded yet.
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {athletePRs.map(row => (
                      <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          background: 'var(--color-bg-secondary)',
                          border: '0.5px solid var(--color-border-tertiary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 9,
                          fontWeight: 700,
                          color: 'var(--color-text-secondary)',
                          flexShrink: 0,
                        }}>
                          {row.athleteInitials}
                        </div>
                        <span style={{
                          flex: 1,
                          fontSize: 'var(--text-caption)',
                          color: 'var(--color-text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {row.athleteName}
                        </span>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-body)',
                          fontWeight: 600,
                          color: 'var(--color-text-primary)',
                        }}>
                          {row.pr_value_kg} kg
                        </span>
                        <span style={{
                          fontSize: 9,
                          color: 'var(--color-text-tertiary)',
                          width: 56,
                          textAlign: 'right',
                        }}>
                          {formatDate(row.pr_date)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Bar chart */}
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 2, height: 32 }}>
                    {athletePRs.slice(0, 14).map(row => {
                      const pct = maxPR > 0 ? ((row.pr_value_kg ?? 0) / maxPR) * 100 : 0;
                      return (
                        <div
                          key={row.id}
                          style={{
                            flex: 1,
                            borderRadius: '2px 2px 0 0',
                            height: `${Math.max(pct, 4)}%`,
                            background: (category?.color ?? 'var(--color-accent)'),
                            opacity: 0.6,
                          }}
                          title={`${row.athleteName}: ${row.pr_value_kg} kg`}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Roster usage chart */}
            {usageWeeks.length > 0 && (
              <div>
                <SectionLabel>Usage history (all athletes)</SectionLabel>
                <UsageHistoryChart weeks={usageWeeks} />
              </div>
            )}
          </>
        )}

        {/* Related exercises */}
        {relatedExercises.length > 0 && (
          <div>
            <SectionLabel>Related ({catName})</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {relatedExercises.map(rex => (
                <RelatedChip key={rex.id} rex={rex} onSelect={onSelectExercise} />
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <SectionLabel>Notes</SectionLabel>
            {!editingNotes && (
              <button
                onClick={() => setEditingNotes(true)}
                style={{
                  color: 'var(--color-text-tertiary)',
                  padding: 2,
                  borderRadius: 'var(--radius-sm)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: -14,
                }}
              >
                <Edit2 size={10} />
              </button>
            )}
          </div>
          {editingNotes ? (
            <Textarea
              autoFocus
              rows={3}
              value={notesValue}
              onChange={e => setNotesValue(e.target.value)}
              onBlur={saveNotes}
            />
          ) : (
            <p
              style={{
                fontSize: 'var(--text-body)',
                color: notesValue ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
                fontStyle: notesValue ? 'normal' : 'italic',
                cursor: 'text',
                minHeight: 28,
                lineHeight: 'var(--leading-body)',
                margin: 0,
              }}
              onClick={() => setEditingNotes(true)}
            >
              {notesValue || 'Click to add notes…'}
            </p>
          )}
        </div>

        {/* External link */}
        {exercise.link && (
          <div>
            <SectionLabel>Reference</SectionLabel>
            <a
              href={exercise.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 'var(--text-body)',
                color: 'var(--color-accent)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textDecoration: 'none',
              }}
            >
              <ExternalLink size={12} style={{ flexShrink: 0 }} />
              {exercise.link}
            </a>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '12px 16px',
        borderTop: '0.5px solid var(--color-border-tertiary)',
        flexShrink: 0,
      }}>
        <Button
          variant="primary"
          size="sm"
          icon={<Edit2 size={13} />}
          style={{ flex: 1 }}
          onClick={() => onEdit(exercise)}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Archive size={13} />}
          onClick={() => onArchive(exercise.id)}
        >
          Archive
        </Button>
      </div>

      {/* xRM Modal */}
      {showXrmModal && (
        <XrmTableModal
          oneRM={currentPR?.pr_value_kg ?? null}
          prHistory={prHistory}
          exerciseName={exercise.name}
          onClose={() => setShowXrmModal(false)}
        />
      )}
    </div>
  );
}

// ── Related chip (needs hover state) ──────────────────────────────

function RelatedChip({
  rex,
  onSelect,
}: {
  rex: Exercise;
  onSelect: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={() => onSelect(rex.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        border: `0.5px solid ${hovered ? 'var(--color-border-primary)' : 'var(--color-border-tertiary)'}`,
        borderRadius: 'var(9999px)',
        fontSize: 'var(--text-label)',
        color: 'var(--color-text-secondary)',
        background: hovered ? 'var(--color-bg-secondary)' : 'transparent',
        cursor: 'pointer',
        transition: 'all 100ms ease-out',
      }}
    >
      <ColorDot size={6} color={rex.color} />
      {rex.exercise_code || rex.name}
    </button>
  );
}
