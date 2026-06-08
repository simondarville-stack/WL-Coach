// Export helpers: CSV / TSV / XLSX from the result, SVG from a rendered chart,
// and print. All read the already-aggregated AnalysisResult — no re-aggregation.

import * as XLSX from 'xlsx';
import type { AnalysisResult } from '../../../lib/analysis';
import { dimLabel } from './dimensions';

function csvField(v: string | number | null | undefined, sep: ',' | '\t'): string {
  if (v == null) return '';
  const s = String(v);
  const needsQuote = sep === ',' ? /[",\n;]/.test(s) : /["\t\n]/.test(s);
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Shared tidy table: row-dimension columns, then one column per col-tuple ×
 *  measure facet, plus a grand-total row. Numbers stay numeric (for XLSX). */
function buildTidy(result: AnalysisResult): { header: string[]; rows: (string | number | null)[][] } {
  const rowDims = result.rowDimensions.filter((a) => a !== 'state');
  const colDims = result.colDimensions.filter((a) => a !== 'state');
  const colKeys = colDims.length > 0 ? result.colKeys : [[]];

  const lookup = new Map<string, Record<string, number | null>>();
  for (const rec of result.records) lookup.set(JSON.stringify([rec.row, rec.col]), rec.values);
  const grandLookup = new Map<string, Record<string, number | null>>();
  for (const rec of result.grandTotal) grandLookup.set(JSON.stringify(rec.col), rec.values);

  const leaves: { colKey: string[]; key: string; label: string }[] = [];
  for (const ck of colKeys) {
    for (const m of result.measures) {
      const facet = m.state === 'planned' ? ' (plan)' : m.state === 'performed' ? ' (perf)' : m.state === 'delta' ? ' Δ' : m.state === 'adherence' ? ' adh' : '';
      const prefix = ck.length ? `${ck.join(' · ')} · ` : '';
      leaves.push({ colKey: ck, key: m.key, label: `${prefix}${m.label}${facet}${m.unit ? ` (${m.unit})` : ''}` });
    }
  }

  const round = (v: number | null | undefined) => (v == null ? '' : Math.round(v * 100) / 100);
  const header = [...rowDims.map(dimLabel), ...leaves.map((l) => l.label)];
  const rows: (string | number | null)[][] = [];
  for (const rk of result.rowKeys) {
    const cells: (string | number | null)[] = rowDims.length ? [...rk] : ['Total'];
    for (const leaf of leaves) cells.push(round(lookup.get(JSON.stringify([rk, leaf.colKey]))?.[leaf.key]));
    rows.push(cells);
  }
  // Grand total row (only meaningful with row dimensions and raw values).
  if (rowDims.length >= 1 && result.grandTotal.length && result.meta.normalization === 'none' && result.rowKeys.length > 1) {
    const cells: (string | number | null)[] = ['Total', ...Array(Math.max(0, rowDims.length - 1)).fill('')];
    for (const leaf of leaves) cells.push(round(grandLookup.get(JSON.stringify(leaf.colKey))?.[leaf.key]));
    rows.push(cells);
  }
  return { header, rows };
}

function serialize(result: AnalysisResult, sep: ',' | '\t'): string {
  const { header, rows } = buildTidy(result);
  return [header, ...rows].map((r) => r.map((c) => csvField(c, sep)).join(sep)).join('\n');
}

export function resultToCsv(result: AnalysisResult): string {
  return serialize(result, ',');
}

/** Tab-separated — pastes straight into Excel / email tables via the clipboard. */
export function resultToTsv(result: AnalysisResult): string {
  return serialize(result, '\t');
}

/** A real .xlsx workbook (numbers stay numeric so Excel can sum them). */
export function downloadXlsx(result: AnalysisResult, filename: string): void {
  const { header, rows } = buildTidy(result);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Analysis');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/** Copy the tidy table to the clipboard as TSV (best-effort). */
export async function copyResultToClipboard(result: AnalysisResult): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(resultToTsv(result));
    return true;
  } catch {
    return false;
  }
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
