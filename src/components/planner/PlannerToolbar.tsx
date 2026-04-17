import { Settings2, Copy, ClipboardPaste, Printer, BarChart2 } from 'lucide-react';

interface PlannerToolbarProps {
  canCopyPaste: boolean;
  copiedWeekStart: string | null;
  showLoadDistribution: boolean;
  onDayConfig: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onPrint: () => void;
  onToggleLoadDistribution: () => void;
}

function ToolBtn({
  onClick,
  title,
  active,
  disabled,
  children,
}: {
  onClick: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        padding: 6, borderRadius: 'var(--radius-sm)', border: 'none',
        background: active ? 'var(--color-accent-muted)' : 'transparent',
        color: active ? 'var(--color-accent)' : disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.1s',
        display: 'flex', alignItems: 'center',
      }}
      onMouseEnter={e => {
        if (!disabled && !active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)';
      }}
      onMouseLeave={e => {
        if (!disabled && !active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

export function PlannerToolbar({
  canCopyPaste,
  copiedWeekStart,
  showLoadDistribution,
  onDayConfig,
  onCopy,
  onPaste,
  onPrint,
  onToggleLoadDistribution,
}: PlannerToolbarProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <ToolBtn onClick={onDayConfig} title="Day configuration">
        <Settings2 size={16} />
      </ToolBtn>
      {canCopyPaste && (
        <>
          <ToolBtn onClick={onCopy} title="Copy week">
            <Copy size={16} />
          </ToolBtn>
          <ToolBtn
            onClick={onPaste}
            title={copiedWeekStart ? 'Paste week' : 'No week copied'}
            disabled={!copiedWeekStart}
          >
            <ClipboardPaste size={16} />
          </ToolBtn>
        </>
      )}
      <ToolBtn onClick={onPrint} title="Print week">
        <Printer size={16} />
      </ToolBtn>
      <ToolBtn onClick={onToggleLoadDistribution} title="Load distribution" active={showLoadDistribution}>
        <BarChart2 size={16} />
      </ToolBtn>
    </div>
  );
}
