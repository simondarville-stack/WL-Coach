import { ChevronUp, ChevronDown } from 'lucide-react';
import { useDockState, type DockTab } from './useDockState';

interface TabDef {
  key: DockTab;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'exercises', label: 'Exercises' },
  { key: 'templates', label: 'Templates' },
];

const HEADER_HEIGHT = 32;
const EXPANDED_HEIGHT = 220;

export function PlannerDock() {
  const { tab, setTab, collapsed, setCollapsed } = useDockState();

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 30,
        marginTop: 16,
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-primary)',
        borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
        display: 'flex',
        flexDirection: 'column',
        height: collapsed ? HEADER_HEIGHT : EXPANDED_HEIGHT,
        overflow: 'hidden',
        transition: 'height 0.15s ease-out',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '4px 12px',
          borderBottom: collapsed ? 'none' : '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-bg-secondary)',
          flexShrink: 0,
          height: HEADER_HEIGHT,
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-caption)',
            fontWeight: 500,
            color: 'var(--color-text-tertiary)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Dock
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {TABS.map(t => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  if (collapsed) setCollapsed(false);
                }}
                style={{
                  fontSize: 11,
                  fontWeight: active ? 500 : 400,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: active ? 'var(--color-bg-primary)' : 'transparent',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  boxShadow: active ? 'inset 0 0 0 0.5px var(--color-border-secondary)' : 'none',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand dock' : 'Collapse dock'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--color-text-tertiary)',
            borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          <PlaceholderBody tab={tab} />
        </div>
      )}
    </div>
  );
}

function PlaceholderBody({ tab }: { tab: DockTab }) {
  const msg = tab === 'exercises'
    ? 'Draggable exercises will appear here.'
    : 'Saved programme templates will appear here.';
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--color-text-tertiary)',
        fontStyle: 'italic',
        textAlign: 'center',
        padding: '32px 0',
      }}
    >
      {msg}
    </div>
  );
}
