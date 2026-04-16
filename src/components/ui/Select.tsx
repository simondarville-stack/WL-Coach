import { forwardRef } from 'react';
import type { SelectHTMLAttributes, ReactNode } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  size?: 'md' | 'lg';
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', className = '', disabled, children, ...rest },
  ref
) {
  const height = size === 'lg' ? '40px' : '32px';

  return (
    <select
      ref={ref}
      disabled={disabled}
      className={`emos-input ${className}`}
      style={{
        height,
        padding: '6px 32px 6px 12px',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-body)',
        fontFamily: 'var(--font-sans)',
        background: disabled ? 'var(--color-bg-secondary)' : 'var(--color-bg-primary)',
        color: disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
        outline: 'none',
        width: '100%',
        cursor: disabled ? 'not-allowed' : 'pointer',
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235F5E5A' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
        backgroundSize: '12px',
      }}
      {...rest}
    >
      {children}
    </select>
  );
});
