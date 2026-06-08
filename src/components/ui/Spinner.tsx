export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="animate-spin rounded-full border-2 border-[color:var(--color-border-tertiary)] border-t-[color:var(--color-accent)]"
      style={{ width: size, height: size }}
    />
  );
}
