/**
 * GroupLogView — coach-facing Log mode for a group plan.
 *
 * Group plans are not logged directly; coaches sync them to athletes via
 * the "Sync to athletes" button, after which each athlete logs their own
 * copy in the athlete app. This view surfaces:
 *   - A sync-status banner with quick context
 *   - A roster of active group members with per-athlete sync state
 *     and an entry point to that athlete's individual Log view
 *
 * Per-athlete session-completion pills could be layered on top later;
 * for now the click-through to the individual LogModeView is the
 * primary affordance.
 */
import { useEffect, useState } from 'react';
import { ChevronRight, UserCheck, UserX } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { Athlete, GroupMemberWithAthlete, TrainingGroup, WeekPlan } from '../../../lib/database.types';
import { useTrainingGroups } from '../../../hooks/useTrainingGroups';

interface GroupLogViewProps {
  group: TrainingGroup;
  weekPlan: WeekPlan | null;
  weekStart: string;
  /** Switch the planner to viewing one athlete's individual plan + log. */
  onSelectAthlete: (athlete: Athlete) => void;
}

interface MemberRow {
  member: GroupMemberWithAthlete;
  synced: boolean;
}

export function GroupLogView({ group, weekPlan, weekStart, onSelectAthlete }: GroupLogViewProps) {
  const { groupMembers, fetchGroupMembers } = useTrainingGroups();
  const [syncedAthleteIds, setSyncedAthleteIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchGroupMembers(group.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadSyncStatus() {
      if (!weekPlan) {
        setSyncedAthleteIds(new Set());
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data, error } = await supabase
        .from('week_plans')
        .select('athlete_id')
        .eq('source_group_plan_id', weekPlan.id)
        .eq('week_start', weekStart)
        .not('athlete_id', 'is', null);
      if (cancelled) return;
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[GroupLogView] failed to load sync status', error);
        setSyncedAthleteIds(new Set());
      } else {
        setSyncedAthleteIds(new Set((data ?? []).map(r => r.athlete_id as string)));
      }
      setLoading(false);
    }
    void loadSyncStatus();
    return () => { cancelled = true; };
  }, [weekPlan?.id, weekStart]);

  const rows: MemberRow[] = groupMembers.map(m => ({
    member: m,
    synced: syncedAthleteIds.has(m.athlete_id),
  }));

  const syncedCount = rows.filter(r => r.synced).length;
  const totalCount = rows.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        padding: '10px 14px',
        background: 'var(--color-bg-secondary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-md)',
        fontSize: 11,
        color: 'var(--color-text-secondary)',
        lineHeight: 1.5,
      }}>
        <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{group.name}</span> · Group plans are logged per athlete. Synced
        athletes write their own session in the athlete app; their entries roll up here.
        {totalCount > 0 && (
          <span style={{ marginLeft: 6, color: 'var(--color-text-tertiary)' }}>
            ({syncedCount}/{totalCount} synced this week)
          </span>
        )}
      </div>

      <div style={{
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: '14px 16px', fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            Loading athletes…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '14px 16px', fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            No active athletes in this group yet.
          </div>
        ) : (
          rows.map(({ member, synced }, idx) => (
            <button
              key={member.id}
              onClick={() => onSelectAthlete(member.athlete)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                borderTop: idx === 0 ? 'none' : '0.5px solid var(--color-border-tertiary)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background var(--transition-fast)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              {synced ? (
                <UserCheck size={14} style={{ color: 'var(--color-success-text, #15803d)' }} />
              ) : (
                <UserX size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              )}
              <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>
                {member.athlete.name}
              </span>
              <span style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                background: synced ? 'var(--color-success-bg, #dcfce7)' : 'var(--color-bg-tertiary)',
                color: synced ? 'var(--color-success-text, #15803d)' : 'var(--color-text-tertiary)',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {synced ? 'Synced' : 'Not synced'}
              </span>
              <ChevronRight size={12} style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
