/**
 * SourceBadge — "G" / "I" marker for an exercise on an individual week plan
 * that is linked to a group plan.
 *
 * `planned_exercises.source` records where a row came from: 'group' (written by
 * the group-plan sync, and replaced on the next sync) or 'individual' (the
 * coach added or edited it for this athlete, which pins it against sync). On a
 * synced athlete the coach needs to see that difference on EVERY row, not just
 * on plain exercises — combos, GPP blocks and the text/video/image sentinels
 * are all synced too, and used to render with no marker at all.
 *
 * When `onRevert` is provided, the "I" badge is also the undo affordance: one
 * click reverts the row to the group plan's current version (the caller runs
 * the confirm + service call — see requestRevertToGroup). "G" stays inert —
 * there is nothing to revert a group row to.
 *
 * Renders nothing when the plan isn't group-linked, or when `source` is null
 * (rows written before the field was tracked — an honest "unknown" beats an
 * invented label).
 */
interface SourceBadgeProps {
  /** planned_exercises.source */
  source: string | null | undefined;
  /** True only on an individual plan that carries source_group_plan_id. */
  isLinkedToGroupPlan: boolean;
  /** Makes the "I" badge clickable: revert this row to the group version. */
  onRevert?: () => void;
}

const STYLES: Record<string, { label: string; title: string; bg: string; fg: string }> = {
  group: {
    label: 'G',
    title: 'From the group plan — replaced on the next group sync',
    bg: 'rgba(99,102,241,0.08)',
    fg: '#6366F1',
  },
  individual: {
    label: 'I',
    title: 'Individual for this athlete — kept when the group plan is synced',
    bg: 'rgba(245,158,11,0.08)',
    fg: '#D97706',
  },
};

export function SourceBadge({ source, isLinkedToGroupPlan, onRevert }: SourceBadgeProps) {
  if (!isLinkedToGroupPlan) return null;
  const style = source ? STYLES[source] : undefined;
  if (!style) return null;

  const baseStyle = {
    fontSize: 'var(--text-caption)',
    padding: '2px 6px',
    background: style.bg,
    color: style.fg,
    borderRadius: 'var(--radius-sm)',
    fontWeight: 600,
    flexShrink: 0,
    lineHeight: 1.2,
  } as const;

  if (source === 'individual' && onRevert) {
    return (
      <button
        title={`${style.title}. Click to revert to the group version.`}
        onClick={e => {
          // Rows open editors on click — the badge must not.
          e.stopPropagation();
          onRevert();
        }}
        style={{
          ...baseStyle,
          border: `1px dashed ${style.fg}`,
          cursor: 'pointer',
          padding: '1px 5px',
        }}
      >
        {style.label}
      </button>
    );
  }

  return (
    <span title={style.title} style={baseStyle}>
      {style.label}
    </span>
  );
}
