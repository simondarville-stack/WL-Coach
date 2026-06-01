// DockGroupCard — the shared "parent + day rows" card used in the dock for
// both programme templates and parked clipboard weeks, so they look and behave
// identically: a draggable header (name + day-count badge + optional action +
// description) over a list of draggable day rows, each previewing its exercises.

import type { ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

export interface DockGroupCardDay {
  key: string;
  /** Small mono index shown before the label (day position). */
  index: number | string;
  label: string;
  /** Exercise names for the inline preview line. */
  previewNames: string[];
  onDragStart: (e: React.DragEvent) => void;
  title?: string;
}

interface DockGroupCardProps {
  title: string;
  /** e.g. "4 days". */
  countLabel: string;
  description?: string | null;
  /** Tooltip on the draggable header. */
  dragTitle?: string;
  onHeaderDragStart: (e: React.DragEvent) => void;
  onDoubleClick?: () => void;
  /** A small control rendered at the end of the header row (import / remove). */
  headerAction?: ReactNode;
  days: DockGroupCardDay[];
}

export function DockGroupCard({
  title, countLabel, description, dragTitle,
  onHeaderDragStart, onDoubleClick, headerAction, days,
}: DockGroupCardProps) {
  return (
    <div
      onDoubleClick={onDoubleClick}
      title={onDoubleClick ? 'Double-click to preview' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <div
        draggable
        onDragStart={onHeaderDragStart}
        title={dragTitle}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '6px 8px',
          background: 'var(--color-bg-secondary)',
          borderBottom: days.length > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none',
          cursor: 'grab',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GripVertical size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.25,
              flex: 1,
              minWidth: 0,
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-tertiary)',
              padding: '1px 6px',
              background: 'var(--color-bg-tertiary)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {countLabel}
          </span>
          {headerAction}
        </div>
        {description && (
          <span
            style={{
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontStyle: 'italic',
              paddingLeft: 17,
            }}
          >
            {description}
          </span>
        )}
      </div>
      {days.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {days.map(day => <DockGroupDayRow key={day.key} day={day} />)}
        </div>
      )}
    </div>
  );
}

function DockGroupDayRow({ day }: { day: DockGroupCardDay }) {
  const preview = day.previewNames.slice(0, 4).join(' · ');
  const overflow = day.previewNames.length > 4 ? ` …+${day.previewNames.length - 4}` : '';
  const previewText = day.previewNames.length === 0 ? 'No exercises' : preview + overflow;

  return (
    <div
      draggable
      onDragStart={day.onDragStart}
      onDoubleClick={e => e.stopPropagation()}
      title={day.title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '4px 8px',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        cursor: 'grab',
        transition: 'background var(--transition-fast)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-secondary)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <GripVertical size={10} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <span
          style={{
            fontSize: 10,
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
            minWidth: 14,
          }}
        >
          {day.index}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {day.label}
        </span>
      </div>
      <span
        style={{
          fontSize: 'var(--text-caption)',
          color: day.previewNames.length === 0 ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
          fontStyle: day.previewNames.length === 0 ? 'italic' : 'normal',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          paddingLeft: 16,
        }}
      >
        {previewText}
      </span>
    </div>
  );
}
