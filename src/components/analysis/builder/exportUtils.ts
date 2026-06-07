// Export helpers: CSV from the result, SVG from a rendered chart, and print.
// All read the already-aggregated AnalysisResult — no re-aggregation.

import type { AnalysisResult } from '../../../lib/analysis';
import { dimLabel } from './dimensions';

function csvField(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Tidy CSV: row-dimension columns, then one column per column-tuple × measure facet. */
export function resultToCsv(result: AnalysisResult): string {
  const rowDims = result.rowDimensions.filter((a) => a !== 'state');
  const colDims = result.colDimensions.filter((a) => a !== 'state');
  const colKeys = colDims.length > 0 ? result.colKeys : [[]];

  const lookup = new Map<string, Record<string, number | null>>();
  for (const rec of result.records) lookup.set(JSON.stringify([rec.row, rec.col]), rec.values);

  const leaves: { colKey: string[]; key: string; label: string }[] = [];
  for (const ck of colKeys) {
    for (const m of result.measures) {
      const facet = m.state === 'planned' ? ' (plan)' : m.state === 'performed' ? ' (perf)' : m.state === 'delta' ? ' Δ' : m.state === 'adherence' ? ' adh' : '';
      const prefix = ck.length ? `${ck.join(' · ')} · ` : '';
      leaves.push({ colKey: ck, key: m.key, label: `${prefix}${m.label}${facet}${m.unit ? ` (${m.unit})` : ''}` });
    }
  }

  const header = [...rowDims.map(dimLabel), ...leaves.map((l) => l.label)];
  const lines = [header.map(csvField).join(',')];
  for (const rk of result.rowKeys) {
    const cells: (string | number | null)[] = rowDims.length ? [...rk] : ['Total'];
    for (const leaf of leaves) {
      const v = lookup.get(JSON.stringify([rk, leaf.colKey]))?.[leaf.key];
      cells.push(v == null ? '' : Math.round(v * 100) / 100);
    }
    lines.push(cells.map(csvField).join(','));
  }
  return lines.join('\n');
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Serialize the first Recharts SVG inside `container` and download it. */
export function exportChartSvg(container: HTMLElement | null, filename: string): boolean {
  const svg = container?.querySelector('svg.recharts-surface') ?? container?.querySelector('svg');
  if (!svg) return false;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Inline a white background so the exported file isn't transparent.
  clone.style.background = '#ffffff';
  const text = new XMLSerializer().serializeToString(clone);
  downloadText(filename, '<?xml version="1.0" encoding="UTF-8"?>\n' + text, 'image/svg+xml');
  return true;
}

export function triggerPrint(): void {
  window.print();
}
