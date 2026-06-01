import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  /** Square, label-less icon button. Renders only `icon`, centered, with
   *  equal width/height per size and no horizontal padding. */
  iconOnly?: boolean;
  children?: ReactNode;
}

const SIZE_STYLES: Record<ButtonSize, { height: string; padding: string; fontSize: string }> = {
  sm: { height: '28px', padding: '4px 10px', fontSize: 'var(--text-caption)' },
  md: { height: '32px', padding: '6px 14px', fontSize: 'var(--text-label)' },
  lg: { height: '40px', padding: '10px 18px', fontSize: 'var(--text-body)' },
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'emos-btn-primary',
  secondary: 'emos-btn-secondary',
  ghost: 'emos-btn-ghost',
  danger: 'emos-btn-danger',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconPosition = 'left', iconOnly = false, children, className = '', disabled, ...rest },
  ref
) {
  const sizeStyle = SIZE_STYLES[size];

  return (
    <button
      ref={ref}
      disabled={disabled}
      className={`emos-btn ${VARIANT_CLASSES[variant]} ${className}`}
      style={{
        fontFamily: 'var(--font-sans)',
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-xs)',
        transition: 'all 100ms ease-out',
        opacity: disabled ? 0.4 : 1,
        ...sizeStyle,
        ...(iconOnly ? { width: sizeStyle.height, padding: 0 } : {}),
      }}
      {...rest}
    >
      {icon && iconPosition === 'left' && icon}
      {!iconOnly && children}
      {icon && iconPosition === 'right' && icon}
    </button>
  );
});
