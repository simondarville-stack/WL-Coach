import type { CSSProperties, ReactNode } from 'react';

interface RibbonProps {
  color: string;              // Any CSS color
  thickness?: 2 | 3;
  position?: 'left' | 'top';
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
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
