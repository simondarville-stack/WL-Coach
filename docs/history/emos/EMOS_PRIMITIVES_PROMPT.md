# EMOS — PROMPT 3: PRIMITIVES LIBRARY

This is step 3 of 3 in the design system rollout. It extracts the
inline styles from `SystemGuide.tsx` into reusable primitive
components in `src/components/ui/`, then updates `SystemGuide.tsx` to
use those primitives. After this step, the rest of the app can migrate
page by page using these primitives.

Prerequisites (already committed):
- `src/styles/tokens.css` with all CSS variables (Prompt 1)
- `tailwind.config.js` extended with EMOS tokens (Prompt 1)
- `/system` route renders every primitive inline (Prompt 2)

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each major section and fix errors before continuing. Commit
once at the end with message: `feat: EMOS primitives library`.

**IMPORTANT:**
- Do NOT modify any existing pages or components yet. The migration
  of real pages is the next phase, not this one.
- Keep existing components `src/components/ui/MetricStrip.tsx` and
  `src/components/ui/Spinner.tsx` untouched.
- All new primitives follow the tokens — never hardcode colors.

---

## STEP 1: CREATE THE PRIMITIVES

Create each file below in `src/components/ui/`. Each primitive should
be a single file. Use Tailwind classes where they map cleanly to
tokens; use inline `style` with CSS variables where Tailwind doesn't
cover the token.

### 1.1 `Button.tsx`

```tsx
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
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
  { variant = 'secondary', size = 'md', icon, iconPosition = 'left', children, className = '', disabled, ...rest },
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
        gap: 'var(--space-xs)',
        transition: 'all 100ms ease-out',
        opacity: disabled ? 0.4 : 1,
        ...sizeStyle,
      }}
      {...rest}
    >
      {icon && iconPosition === 'left' && icon}
      {children}
      {icon && iconPosition === 'right' && icon}
    </button>
  );
});
```

Also append these styles to `src/styles/tokens.css` at the bottom:

```css
/* ============================================================
 * Button variants
 * ============================================================ */

.emos-btn {
  border: none;
  white-space: nowrap;
  user-select: none;
}

.emos-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.emos-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.emos-btn-primary {
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  font-weight: 500;
}

.emos-btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.emos-btn-secondary {
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  border: 0.5px solid var(--color-border-secondary);
  font-weight: 400;
}

.emos-btn-secondary:hover:not(:disabled) {
  background: var(--color-bg-secondary);
  border-color: var(--color-border-primary);
}

.emos-btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
  font-weight: 400;
}

.emos-btn-ghost:hover:not(:disabled) {
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
}

.emos-btn-danger {
  background: var(--color-bg-primary);
  color: var(--color-danger-text);
  border: 0.5px solid var(--color-danger-border);
  font-weight: 400;
}

.emos-btn-danger:hover:not(:disabled) {
  background: var(--color-danger-bg);
}
```

After adding the CSS, verify build passes.

### 1.2 `Input.tsx`

```tsx
import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  size?: 'md' | 'lg';
  mono?: boolean;  // Use monospace font for numeric input
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
```

Append to `tokens.css`:

```css
/* ============================================================
 * Input
 * ============================================================ */

.emos-input::placeholder {
  color: var(--color-text-tertiary);
}

.emos-input:hover:not(:disabled):not(:focus) {
  border-color: var(--color-border-secondary);
}

.emos-input:focus {
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}
```

### 1.3 `Select.tsx`

```tsx
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
```

### 1.4 `Textarea.tsx`

```tsx
import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  // No extra props; uses native rows for height control
}

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
```

### 1.5 `Badge.tsx`

```tsx
import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type BadgeShape = 'rect' | 'pill';

interface BadgeProps {
  variant?: BadgeVariant;
  shape?: BadgeShape;
  children: ReactNode;
  className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string }> = {
  success: { bg: 'var(--color-success-bg)', color: 'var(--color-success-text)' },
  warning: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning-text)' },
  danger: { bg: 'var(--color-danger-bg)', color: 'var(--color-danger-text)' },
  info: { bg: 'var(--color-info-bg)', color: 'var(--color-info-text)' },
  neutral: { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' },
};

export function Badge({ variant = 'neutral', shape = 'rect', children, className = '' }: BadgeProps) {
  const { bg, color } = VARIANT_STYLES[variant];

  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: shape === 'pill' ? '999px' : 'var(--radius-sm)',
        fontSize: 'var(--text-caption)',
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        background: bg,
        color,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}
```

### 1.6 `ColorDot.tsx`

```tsx
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
```

### 1.7 `Ribbon.tsx`

```tsx
import type { ReactNode } from 'react';

interface RibbonProps {
  color: string;              // Any CSS color
  thickness?: 2 | 3;
  position?: 'left' | 'top';
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Ribbon({ color, thickness = 2, position = 'left', children, className = '', style = {} }: RibbonProps) {
  const borderProp = position === 'left' ? 'borderLeft' : 'borderTop';

  return (
    <div
      className={className}
      style={{
        [borderProp]: `${thickness}px solid ${color}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
```

### 1.8 `PageHeader.tsx`

```tsx
import type { ReactNode } from 'react';

interface PageHeaderProps {
  eyebrow?: ReactNode;       // Small context above title (e.g. "Macrocycle III")
  title: ReactNode;          // Main page title
  subtitle?: ReactNode;      // Small description below
  metadata?: ReactNode;      // Right-aligned meta (e.g. date range)
}

export function PageHeader({ eyebrow, title, subtitle, metadata }: PageHeaderProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingBottom: 'var(--space-lg)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        marginBottom: 'var(--space-xl)',
        gap: 'var(--space-lg)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-tertiary)',
              marginBottom: '6px',
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1
          style={{
            fontSize: 'var(--text-page-title)',
            fontWeight: 500,
            letterSpacing: 'var(--tracking-page-title)',
            lineHeight: 'var(--leading-page-title)',
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <div
            style={{
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-secondary)',
              marginTop: '4px',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {metadata && (
        <div
          style={{
            fontSize: 'var(--text-label)',
            color: 'var(--color-text-secondary)',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.7,
            flexShrink: 0,
          }}
        >
          {metadata}
        </div>
      )}
    </header>
  );
}
```

### 1.9 `SectionHeader.tsx`

```tsx
import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: ReactNode;
  caption?: ReactNode;   // Optional right-aligned subdued text
  className?: string;
}

export function SectionHeader({ title, caption, className = '' }: SectionHeaderProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginTop: 'var(--space-xl)',
        marginBottom: 'var(--space-md)',
        gap: 'var(--space-md)',
      }}
    >
      <h2
        style={{
          fontSize: 'var(--text-section)',
          fontWeight: 500,
          letterSpacing: 'var(--tracking-section)',
          lineHeight: 'var(--leading-section)',
          color: 'var(--color-text-primary)',
          margin: 0,
        }}
      >
        {title}
      </h2>
      {caption && (
        <span
          style={{
            fontSize: 'var(--text-label)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          {caption}
        </span>
      )}
    </div>
  );
}
```

### 1.10 `StatCard.tsx` + `StatGrid.tsx`

```tsx
// StatGrid.tsx
import type { ReactNode } from 'react';

interface StatGridProps {
  columns?: 2 | 3 | 4 | 5;
  children: ReactNode;
}

export function StatGrid({ columns = 4, children }: StatGridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: '1px',
        background: 'var(--color-border-tertiary)',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}
```

```tsx
// StatCard.tsx
import type { ReactNode } from 'react';

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;      // The big number
  unit?: string;         // Optional unit (e.g. "kg", "t", "%")
  delta?: ReactNode;     // Optional line below (trend, subtext)
}

export function StatCard({ label, value, unit, delta }: StatCardProps) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--color-bg-secondary)' }}>
      <div
        style={{
          fontSize: 'var(--text-label)',
          color: 'var(--color-text-secondary)',
          marginBottom: '6px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '22px',
          fontWeight: 500,
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-primary)',
          lineHeight: 1.1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
        {unit && (
          <sub
            style={{
              fontSize: 'var(--text-label)',
              color: 'var(--color-text-tertiary)',
              fontWeight: 400,
              fontFamily: 'var(--font-sans)',
              marginLeft: '3px',
              verticalAlign: 'baseline',
            }}
          >
            {unit}
          </sub>
        )}
      </div>
      {delta && (
        <div
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            marginTop: '4px',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
```

### 1.11 `DataTable.tsx`

This is the most complex primitive. Keep it flexible — generic over row type.

```tsx
import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  width?: string;                 // e.g. "40px", "15%"
  align?: 'left' | 'right' | 'center';
  render: (row: T, index: number) => ReactNode;
  mono?: boolean;                 // Use mono font for this column
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string | number;
  isCurrentRow?: (row: T, index: number) => boolean;
  onRowClick?: (row: T, index: number) => void;
  summaryRow?: ReactNode;          // Optional "Average" / "Total" row at bottom
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  isCurrentRow,
  onRowClick,
  summaryRow,
}: DataTableProps<T>) {
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-label)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              style={{
                textAlign: col.align || 'left',
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 'var(--text-label)',
                color: 'var(--color-text-secondary)',
                padding: '10px 12px 8px',
                borderBottom: '0.5px solid var(--color-border-secondary)',
                width: col.width,
              }}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const current = isCurrentRow ? isCurrentRow(row, i) : false;
          return (
            <tr
              key={getRowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              style={{
                background: current ? 'var(--color-info-bg)' : 'transparent',
                cursor: onRowClick ? 'pointer' : 'default',
              }}
            >
              {columns.map((col, colIdx) => (
                <td
                  key={col.key}
                  style={{
                    padding: '11px 12px',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                    textAlign: col.align || 'left',
                    color: 'var(--color-text-primary)',
                    fontFamily: col.mono === false ? 'var(--font-sans)' : 'var(--font-mono)',
                    fontSize: col.mono === false ? 'var(--text-label)' : 'inherit',
                    borderLeft: colIdx === 0 && current ? '2px solid var(--color-accent)' : colIdx === 0 ? '2px solid transparent' : undefined,
                  }}
                >
                  {col.render(row, i)}
                </td>
              ))}
            </tr>
          );
        })}
        {summaryRow}
      </tbody>
    </table>
  );
}
```

### 1.12 `Modal.tsx`

```tsx
import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: ModalSize;
  children: ReactNode;
  footer?: ReactNode;
}

const SIZE_WIDTHS: Record<ModalSize, string> = {
  sm: '28rem',
  md: '32rem',
  lg: '42rem',
  xl: '56rem',
};

export function Modal({ isOpen, onClose, title, size = 'md', children, footer }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-backdrop-in"
      style={{ background: 'rgba(0, 0, 0, 0.15)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-dialog-in"
        style={{
          width: '100%',
          maxWidth: SIZE_WIDTHS[size],
          maxHeight: '85vh',
          background: 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 'var(--radius-xl)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {title && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-lg)',
              borderBottom: '0.5px solid var(--color-border-tertiary)',
            }}
          >
            <h2
              style={{
                fontSize: 'var(--text-section)',
                fontWeight: 500,
                letterSpacing: 'var(--tracking-section)',
                margin: 0,
                color: 'var(--color-text-primary)',
              }}
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                color: 'var(--color-text-tertiary)',
                display: 'flex',
              }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div style={{ padding: 'var(--space-lg)', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: 'var(--space-md) var(--space-lg)',
              borderTop: '0.5px solid var(--color-border-tertiary)',
              display: 'flex',
              gap: 'var(--space-sm)',
              justifyContent: 'flex-end',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 1.13 `SidePanel.tsx`

```tsx
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type SidePanelWidth = 'detail' | 'editor';

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  width?: SidePanelWidth;
  children: ReactNode;
  footer?: ReactNode;
}

const WIDTHS: Record<SidePanelWidth, string> = {
  detail: '320px',
  editor: '480px',
};

export function SidePanel({ isOpen, onClose, title, width = 'detail', children, footer }: SidePanelProps) {
  if (!isOpen) return null;

  return (
    <div
      className="animate-sidebar-in"
      style={{
        width: WIDTHS[width],
        flexShrink: 0,
        background: 'var(--color-bg-primary)',
        borderLeft: '0.5px solid var(--color-border-tertiary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-md) var(--space-lg)',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-section)',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              minWidth: 0,
              flex: 1,
            }}
          >
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              color: 'var(--color-text-tertiary)',
              display: 'flex',
              flexShrink: 0,
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div style={{ padding: 'var(--space-lg)', overflowY: 'auto', flex: 1 }}>
        {children}
      </div>
      {footer && (
        <div
          style={{
            padding: 'var(--space-md) var(--space-lg)',
            borderTop: '0.5px solid var(--color-border-tertiary)',
            display: 'flex',
            gap: 'var(--space-sm)',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
```

### 1.14 `Card.tsx`

```tsx
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg' | 'none';
}

const PADDING_MAP = {
  none: '0',
  sm: 'var(--space-md)',
  md: 'var(--space-lg)',
  lg: 'var(--space-xl)',
};

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--radius-lg)',
        padding: PADDING_MAP[padding],
      }}
    >
      {children}
    </div>
  );
}
```

### 1.15 `index.ts` — barrel export

Create `src/components/ui/index.ts` to make imports clean:

```typescript
export { Button } from './Button';
export { Input } from './Input';
export { Select } from './Select';
export { Textarea } from './Textarea';
export { Badge } from './Badge';
export { ColorDot } from './ColorDot';
export { Ribbon } from './Ribbon';
export { PageHeader } from './PageHeader';
export { SectionHeader } from './SectionHeader';
export { StatCard } from './StatCard';
export { StatGrid } from './StatGrid';
export { DataTable } from './DataTable';
export type { DataTableColumn } from './DataTable';
export { Modal } from './Modal';
export { SidePanel } from './SidePanel';
export { Card } from './Card';

// Existing primitives (don't remove)
export { Spinner } from './Spinner';
export { MetricStrip } from './MetricStrip';
```

---

## STEP 2: VERIFY BUILD

```bash
npm run build
```

All primitives must compile with no TypeScript errors. Fix any type
issues before continuing.

Common issues:
- Missing `ReactNode` import — add `import type { ReactNode } from 'react'`
- Missing `forwardRef` import
- Missing `CSSProperties` — add to imports if used

---

## STEP 3: REFACTOR SystemGuide.tsx TO USE PRIMITIVES

Now update `src/components/system/SystemGuide.tsx` to use the new
primitives instead of inline styles. This validates the primitives
render correctly and serves as the live library demo.

**Sections to update:**

1. **Buttons section** — replace inline `<button>` tags with `<Button variant size>`
2. **Inputs section** — replace inline `<input>` / `<select>` / `<textarea>` with `<Input>`, `<Select>`, `<Textarea>`
3. **Badges section** — replace inline badge spans with `<Badge variant shape>`
4. **Color dots section** — replace inline span with `<ColorDot color size>`
5. **Ribbons section** — replace inline border divs with `<Ribbon color>`
6. **Stat cards section** — replace the inline grid with `<StatGrid><StatCard /></StatGrid>`
7. **Data tables section** — replace inline `<table>` with `<DataTable columns rows>`
8. **Panels & modals section** — add preview of `<SidePanel>` and `<Modal>` structure

Do NOT update the Colors, Typography, Spacing, Foundations, or Page
Layout sections — those are token documentation, not primitive usage.

**Example conversion — Buttons section:**

Before:
```tsx
<button style={{ ...btnBase, ...sizes.md, ...variants.primary }}>Open week</button>
```

After:
```tsx
import { Button } from '../ui';

<Button variant="primary" size="md">Open week</Button>
```

**Example conversion — Stat cards section:**

Before (long inline grid):
```tsx
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', ... }}>
  {[...].map(s => (
    <div style={{ padding: '14px 16px', background: 'var(--color-bg-secondary)' }}>
      <div style={{ fontSize: 'var(--text-label)', ... }}>{s.label}</div>
      <div style={{ fontSize: '22px', ... }}>{s.value}<sub>{s.unit}</sub></div>
      <div style={{ fontSize: 'var(--text-caption)', ... }}>{s.delta}</div>
    </div>
  ))}
</div>
```

After:
```tsx
import { StatGrid, StatCard } from '../ui';

<StatGrid columns={4}>
  <StatCard label="Total reps" value="1,648" delta="+8.2 %" />
  <StatCard label="Tonnage" value="148.3" unit="t" delta="+12.4 %" />
  <StatCard label="Average load" value="90" unit="kg" delta="−2.1 kg" />
  <StatCard label="Compliance" value="92" unit="%" delta="4 of 5 wks" />
</StatGrid>
```

**Example conversion — Data table section:**

Before (verbose `<table>` with inline styles):
```tsx
<table style={{...}}>
  <thead>...</thead>
  <tbody>
    {rows.map(r => <tr>...</tr>)}
  </tbody>
</table>
```

After:
```tsx
import { DataTable, type DataTableColumn } from '../ui';

type Row = { wk: number; type: string; date: string; reps: string; tonnage: string; avg: string; current: boolean };

const columns: DataTableColumn<Row>[] = [
  { key: 'wk', header: 'Wk', width: '40px', render: r => r.wk },
  { key: 'type', header: 'Type', width: '80px', mono: false, render: r => r.type },
  { key: 'date', header: 'Date', width: '90px', mono: false, render: r => r.date },
  { key: 'reps', header: 'Reps', align: 'right', render: r => r.reps },
  { key: 'tonnage', header: 'Tonnage', align: 'right', render: r => r.tonnage },
  { key: 'avg', header: 'Avg load', align: 'right', render: r => r.avg },
];

const rows: Row[] = [ /* ... */ ];

<DataTable
  columns={columns}
  rows={rows}
  getRowKey={r => r.wk}
  isCurrentRow={r => r.current}
  summaryRow={
    <tr>
      <td colSpan={3} style={{ padding: '12px', borderTop: '0.5px solid var(--color-border-secondary)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>Average</td>
      <td style={{ padding: '12px', borderTop: '0.5px solid var(--color-border-secondary)', textAlign: 'right', fontWeight: 500 }}>149</td>
      <td style={{ padding: '12px', borderTop: '0.5px solid var(--color-border-secondary)', textAlign: 'right', fontWeight: 500 }}>13.5 t</td>
      <td style={{ padding: '12px', borderTop: '0.5px solid var(--color-border-secondary)', textAlign: 'right', fontWeight: 500 }}>91 kg</td>
    </tr>
  }
/>
```

After each section is converted, run `npm run build` to catch type
errors. Navigate to `/system` in the browser to visually verify
nothing broke.

---

## STEP 4: FINAL BUILD + COMMIT

```bash
npm run build
```

Must pass with no errors.

Visual smoke test — navigate through `/system`:
- All 13 sections still render correctly
- No layout regression vs. before
- Primitives produce identical output to the previous inline styles

Commit:
```bash
git add -A
git commit -m "feat: EMOS primitives library

Adds reusable primitive components in src/components/ui/:
- Button (4 variants × 3 sizes)
- Input, Select, Textarea
- Badge (5 variants, rect/pill shape)
- ColorDot (entity identity)
- Ribbon (phase/state context)
- PageHeader, SectionHeader
- StatCard + StatGrid
- DataTable (generic, typed columns, current-row highlight)
- Modal (4 sizes, backdrop, escape-to-close)
- SidePanel (detail/editor widths, no backdrop)
- Card

All primitives read from src/styles/tokens.css — no hardcoded values.
Barrel export in src/components/ui/index.ts.

SystemGuide.tsx refactored to use primitives, validating the library
and serving as live demo."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes with no errors
2. ✅ `src/components/ui/` contains 13 new primitive files + `index.ts`
3. ✅ Existing `MetricStrip.tsx` and `Spinner.tsx` untouched
4. ✅ `tokens.css` has new button styles appended at the bottom
5. ✅ `/system` route still renders correctly, visually identical to before
6. ✅ Buttons section uses `<Button>` primitive
7. ✅ Inputs section uses `<Input>` / `<Select>` / `<Textarea>`
8. ✅ Badges section uses `<Badge>`
9. ✅ Color dots section uses `<ColorDot>`
10. ✅ Ribbons section uses `<Ribbon>`
11. ✅ Stat cards section uses `<StatGrid>` / `<StatCard>`
12. ✅ Data tables section uses `<DataTable>`
13. ✅ No TypeScript errors anywhere
14. ✅ Committed and pushed

---

## NEXT STEP

After this is committed, the grand redesign begins. The first page
migration is the **Exercise Library**, in a separate prompt. That
migration will:

1. Import primitives from `src/components/ui`
2. Replace all inline styles and Tailwind utility classes with
   primitive components
3. Apply the page framing rule (Framing A — standard content page)
4. Ensure all numbers use mono font
5. Apply sentence case to all buttons and headers
6. Use dots for exercise/category identity, ribbons for category
   section headers

Each subsequent page follows the same migration pattern using these
primitives as the vocabulary.
