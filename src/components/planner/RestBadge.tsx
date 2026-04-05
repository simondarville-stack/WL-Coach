interface RestBadgeProps {
  hours: number | null;
  recoveryLevel: 'full' | 'partial' | 'short' | 'same-day' | null;
}

export function RestBadge({ hours, recoveryLevel }: RestBadgeProps) {
  if (hours === null || recoveryLevel === null) return null;

  const styles: Record<string, string> = {
    'full':     'bg-[#E1F5EE] text-[#085041]',
    'partial':  'bg-[#FAEEDA] text-[#633806]',
    'short':    'bg-[#FCEBEB] text-[#791F1F]',
    'same-day': 'bg-[#EEEDFE] text-[#3C3489]',
  };

  const label = hours === 0 ? 'Same day'
    : hours < 1  ? `${Math.round(hours * 60)}min`
    : hours < 24 ? `${Math.round(hours)}h rest`
    : hours === 24 ? '24h rest'
    : hours === 48 ? '48h rest'
    : `${Math.round(hours / 24)}d rest`;

  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${styles[recoveryLevel]}`}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="flex-shrink-0">
        <circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="1"/>
        <path d="M4 2v2l1.5 1" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
      </svg>
      {label}
    </span>
  );
}
