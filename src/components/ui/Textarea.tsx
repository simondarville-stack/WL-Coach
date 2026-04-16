import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className = '', disabled, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      disabled={disabled}
      className={`emos-input ${className}`}
      style={{
        padding: '8px 12px',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-body)',
        fontFamily: 'var(--font-sans)',
        lineHeight: 'var(--leading-body)',
        background: disabled ? 'var(--color-bg-secondary)' : 'var(--color-bg-primary)',
        color: disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
        outline: 'none',
        width: '100%',
        resize: 'vertical',
        minHeight: '64px',
        transition: 'all 100ms ease-out',
      }}
      {...rest}
    />
  );
});
