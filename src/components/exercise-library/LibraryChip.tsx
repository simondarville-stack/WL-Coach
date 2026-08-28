/** Small neutral chip naming the catalogue an exercise comes from. Only
 *  rendered for rows outside the coach's own personal library (a chip on
 *  every row carries no signal). */
export function LibraryChip({ label }: { label: string }) {
  return (
    <span
      title={`From the "${label}" catalogue`}
      style={{
        fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
        background: 'var(--color-bg-secondary)', border: '0.5px solid var(--color-border-tertiary)',
        padding: '0 5px', borderRadius: '999px', whiteSpace: 'nowrap', flexShrink: 0,
        maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {label}
    </span>
  );
}
