import { useState } from 'react';
import { X, Video, Image as ImageIcon, Dumbbell, Layers, Trash2 } from 'lucide-react';
import type { ClipboardItem, ClipboardExerciseDisplay } from './useClipboardState';
import { DockGroupCard } from './DockGroupCard';
import { ClipboardWeekPreviewDialog } from './ClipboardWeekPreviewDialog';

interface ClipboardPanelProps {
  items: ClipboardItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
  /** Called when a planner item is dragged from a DayCard into the
   *  clipboard. `data` is the raw dataTransfer text/plain string; the
   *  parent decides whether it's a single exercise drop or a day drop
   *  and snapshots accordingly. */
  onPlannerDrop: (data: string) => Promise<void> | void;
}

export function ClipboardPanel({ items, onRemove, onClear, onPlannerDrop }: ClipboardPanelProps) {
  const [dragOver, setDragOver] = useState(false);
  const empty = items.length === 0;

  function handleDragOver(e: React.DragEvent) {
    const types = Array.from(e.dataTransfer.types);
    // Accept either a single planned exercise (marker type) or a day header
    // (text/plain starts with DAY:). We can't peek at text/plain during
    // dragover for security, so we rely on the marker type for exercises and
    // accept everything else as a possible DAY drop — handle() guards it.
    const isExerciseDrag = types.includes('application/x-emos-exercise');
    const couldBeDayDrag = types.includes('text/plain');
    if (!isExerciseDrag && !couldBeDayDrag) return;
    e.preventDefault();
    // Don't override dropEffect — exercise rows are dragged with
    // effectAllowed='move' by default, and forcing dropEffect='copy' here
    // would make the drop incompatible (browser shows "not allowed" cursor
    // and the drop event never fires). Leaving dropEffect alone lets the
    // browser pick a compatible value.
    if (!dragOver) setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    // Clipboard → Clipboard drag is a no-op (don't dupe an item by
    // dragging it onto itself). Accept the legacy CANVAS: prefix during
    // the rename window for any in-flight drags that started before
    // the page picked up the new bundle.
    if (data.startsWith('CLIPBOARD:') || data.startsWith('CANVAS:')) return;
    await onPlannerDrop(data);
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={e => void handleDrop(e)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: '100%',
        padding: dragOver ? 6 : 0,
        background: dragOver ? 'var(--color-accent-muted)' : 'transparent',
        border: dragOver
          ? '1px dashed var(--color-accent-border)'
          : '1px dashed transparent',
        borderRadius: 'var(--radius-sm)',
        transition: 'background var(--transition-fast), border-color var(--transition-fast), padding var(--transition-fast)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          paddingBottom: 4,
          borderBottom: '0.5px solid var(--color-border-tertiary)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Clipboard
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          Drop exercises or day headers here to park them; drag back into any day to use them.
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
          {items.length === 0 ? 'empty' : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </span>
        {!empty && (
          <button
            onClick={onClear}
            title="Clear clipboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              padding: '2px 8px',
              border: '0.5px solid var(--color-border-secondary)',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-secondary)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            <Trash2 size={11} />
            Clear
          </button>
        )}
      </div>

      {empty ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 8px',
            fontSize: 11,
            color: 'var(--color-text-tertiary)',
            fontStyle: 'italic',
            textAlign: 'center',
            border: '1px dashed var(--color-border-tertiary)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          {dragOver
            ? 'Drop here to park'
            : 'Drag an exercise or a day header here to park it for later'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 6,
            alignItems: 'start',
          }}
        >
          {items.map(item =>
            item.kind === 'exercise' ? (
              <ExerciseCard key={item.id} item={item} onRemove={() => onRemove(item.id)} />
            ) : item.kind === 'day' ? (
              <DayCard key={item.id} item={item} onRemove={() => onRemove(item.id)} />
            ) : (
              <WeekCard key={item.id} item={item} onRemove={() => onRemove(item.id)} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function SentinelIcon({ kind, color }: { kind: ClipboardExerciseDisplay['sentinel']; color: string }) {
  const common = { size: 11, style: { flexShrink: 0, color } } as const;
  if (kind === 'video') return <Video {...common} />;
  if (kind === 'image') return <ImageIcon {...common} />;
  if (kind === 'gpp') return <Dumbbell {...common} />;
  if (kind === 'combo') return <Layers {...common} />;
  return null;
}

interface ExerciseCardProps {
  item: Extract<ClipboardItem, { kind: 'exercise' }>;
  onRemove: () => void;
}

function ExerciseCard({ item, onRemove }: ExerciseCardProps) {
  const { display, snapshot } = item;
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', `CLIPBOARD:exercise:${item.id}`);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={display.label}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        padding: '5px 22px 5px 6px',
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderLeft: `3px solid ${display.color}`,
        borderRadius: 'var(--radius-sm)',
        cursor: 'grab',
        userSelect: 'none',
        minHeight: 42,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <SentinelIcon kind={display.sentinel} color={display.color} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.2,
            }}
          >
            {display.label}
          </span>
        </div>
        {(display.caption || snapshot.prescription_raw) && (
          <div
            style={{
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-tertiary)',
              fontStyle: 'italic',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.25,
            }}
          >
            {snapshot.prescription_raw || display.caption}
          </div>
        )}
      </div>
      <RemoveBtn onClick={onRemove} />
    </div>
  );
}

interface DayCardItemProps {
  item: Extract<ClipboardItem, { kind: 'day' }>;
  onRemove: () => void;
}

function DayCard({ item, onRemove }: DayCardItemProps) {
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', `CLIPBOARD:day:${item.id}`);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`${item.label} — ${item.exercises.length} exercise${item.exercises.length === 1 ? '' : 's'}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '5px 22px 5px 6px',
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderLeft: '3px solid var(--color-accent)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'grab',
        userSelect: 'none',
        minHeight: 42,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Layers size={11} style={{ flexShrink: 0, color: 'var(--color-accent)' }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.label}
        </span>
        <span
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            flexShrink: 0,
          }}
        >
          · {item.exercises.length}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          paddingLeft: 15,
        }}
      >
        {item.exercises.slice(0, 4).map((ex, i) => (
          <div
            key={i}
            style={{
              fontSize: 10,
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.25,
            }}
          >
            <span style={{ color: ex.display.color, marginRight: 4 }}>•</span>
            {ex.display.label}
          </div>
        ))}
        {item.exercises.length > 4 && (
          <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', fontStyle: 'italic', paddingLeft: 8 }}>
            +{item.exercises.length - 4} more
          </div>
        )}
      </div>
      <RemoveBtn onClick={onRemove} />
    </div>
  );
}

interface WeekCardItemProps {
  item: Extract<ClipboardItem, { kind: 'week' }>;
  onRemove: () => void;
}

// A parked week shown like a programme template: one parent (the week) holding
// all its training days. The whole week drags out via CLIPBOARD:week:<id>; each
// day drags out on its own via CLIPBOARD:week-day:<id>:<dayIndex>.
function WeekCard({ item, onRemove }: WeekCardItemProps) {
  const [showPreview, setShowPreview] = useState(false);
  return (
    <>
      <DockGroupCard
        title={item.label}
        countLabel={`${item.days.length} ${item.days.length === 1 ? 'day' : 'days'}`}
        dragTitle="Drag to apply the whole week"
        onDoubleClick={() => setShowPreview(true)}
        onHeaderDragStart={e => {
          e.dataTransfer.setData('text/plain', `CLIPBOARD:week:${item.id}`);
          e.dataTransfer.setData('application/x-emos-week-paste', '1');
          e.dataTransfer.effectAllowed = 'copy';
        }}
        headerAction={
          <button
            onClick={e => { e.stopPropagation(); onRemove(); }}
            onMouseDown={e => e.stopPropagation()}
            onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
            title="Remove from clipboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              padding: 0,
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger-text)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-primary)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)'; }}
          >
            <X size={10} />
          </button>
        }
        days={item.days.map((day, i) => ({
          key: String(day.dayIndex),
          index: i + 1,
          label: day.label,
          previewNames: day.exercises.map(ex => ex.display.label),
          title: `Drag ${day.label} onto a day to apply just this day`,
          onDragStart: e => {
            e.stopPropagation();
            e.dataTransfer.setData('text/plain', `CLIPBOARD:week-day:${item.id}:${day.dayIndex}`);
            e.dataTransfer.effectAllowed = 'copy';
          },
        }))}
      />
      {showPreview && <ClipboardWeekPreviewDialog week={item} onClose={() => setShowPreview(false)} />}
    </>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={e => e.stopPropagation()}
      onDragStart={e => {
        // The card around us is draggable; clicking × on Firefox can
        // otherwise initiate the parent's drag instead of firing onClick.
        e.preventDefault();
        e.stopPropagation();
      }}
      title="Remove from clipboard"
      style={{
        position: 'absolute',
        top: 3,
        right: 3,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        padding: 0,
        background: 'transparent',
        border: 'none',
        color: 'var(--color-text-tertiary)',
        cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger-text)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
      }}
    >
      <X size={10} />
    </button>
  );
}
