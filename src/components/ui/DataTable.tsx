import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  width?: string;                  // e.g. "40px", "15%"
  align?: 'left' | 'right' | 'center';
  render: (row: T, index: number) => ReactNode;
  mono?: boolean;                  // Use mono font for this column (default true)
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
                textAlign: col.align ?? 'left',
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
                    textAlign: col.align ?? 'left',
                    color: 'var(--color-text-primary)',
                    fontFamily: col.mono === false ? 'var(--font-sans)' : 'var(--font-mono)',
                    fontSize: col.mono === false ? 'var(--text-label)' : 'inherit',
                    borderLeft:
                      colIdx === 0 && current
                        ? '2px solid var(--color-accent)'
                        : colIdx === 0
                        ? '2px solid transparent'
                        : undefined,
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
