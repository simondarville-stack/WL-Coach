interface ColorDotProps {
  color: string;       // Any CSS color — hex, var(--color-...), rgb, etc.
  size?: 6 | 8 | 10;
  className?: string;
}

export function ColorDot({ color, size = 8, className = '' }: ColorDotProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    />
  );
}
