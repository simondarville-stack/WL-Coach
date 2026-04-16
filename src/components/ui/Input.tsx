import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  size?: 'md' | 'lg';
  mono?: boolean; // Use monospace font for numeric input
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', mono = false, className = '', disabled, ...rest },
  ref
) {
  const height = size === 'lg' ? '40px' : '32px';

  return (
    <input
      ref={ref}
      disabled={disabled}
      className={`emos-input ${className}`}
      style={{
        height,
        padding: '6px 12px',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-body)',
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        background: disabled ? 'var(--color-bg-secondary)' : 'var(--color-bg-primary)',
        color: disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
        outline: 'none',
        width: '100%',
        transition: 'all 100ms ease-out',
      }}
      {...rest}
    />
  );
});
