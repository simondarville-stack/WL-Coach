/**
 * sollIstCsv — import/export of Soll–Ist reference models as CSV, so a coach
 * can maintain templates in a spreadsheet and load them into EMOS.
 *
 * Format (header optional, delimiter `;` or `,` auto-detected):
 *
 *   exercise;ref;index;reps
 *   Back squat;CJ;120;3
 *   Snatch pull;SN;108;1
 *
 * `ref` accepts SN / CJ / snatch / clean_and_jerk / 1 / 2 (Kategorie 1 = SN,
 * 2 = C&J, matching the Trainingsmittelkatalog companion sheet). Decimal
 * commas are accepted in the index column when the delimiter is `;`
 * (German-Excel exports).
 */
import type { Exercise } from './database.types';
import type { SollIstRow } from './sollIst';

export interface CsvParseResult {
  rows: SollIstRow[];
  /** Human-readable problems (unmatched exercise, bad number …). */
  warnings: string[];
}

function parseRef(raw: string): 'snatch' | 'clean_and_jerk' | null {
  const v = raw.trim().toLowerCase();
  if (v === 'sn' || v === 'snatch' || v === '1' || v === 'k1') return 'snatch';
  if (v === 'cj' || v === 'c&j' || v === 'clean_and_jerk' || v === 'clean and jerk' || v === '2' || v === 'k2') return 'clean_and_jerk';
  return null;
}

function matchExercise(name: string, exercises: Exercise[]): Exercise | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return (
    exercises.find((e) => e.name.toLowerCase() === n) ??
    exercises.find((e) => e.name.toLowerCase().startsWith(n)) ??
    exercises.find((e) => e.name.toLowerCase().includes(n)) ??
    null
  );
}

export function parseModelCsv(text: string, exercises: Exercise[]): CsvParseResult {
  const rows: SollIstRow[] = [];
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows, warnings: ['File is empty'] };

  // Delimiter: ';' wins when present (German Excel), else ','.
  const delim = lines[0].includes(';') ? ';' : ',';

  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(delim).map((c) => c.trim());
    if (i === 0 && /exercise/i.test(cells[0] ?? '')) continue; // header
    if (cells.length < 3) {
      warnings.push(`Line ${i + 1}: expected exercise${delim}ref${delim}index[${delim}reps] — skipped`);
      continue;
    }
    const [name, refRaw, indexRaw, repsRaw] = cells;
    const refSlot = parseRef(refRaw);
    if (!refSlot) {
      warnings.push(`Line ${i + 1}: unknown reference "${refRaw}" (use SN/CJ or 1/2) — skipped`);
      continue;
    }
    // Decimal comma only valid when it can't be the delimiter.
    const indexPct = parseFloat(delim === ';' ? indexRaw.replace(',', '.') : indexRaw);
    if (!Number.isFinite(indexPct) || indexPct <= 0) {
      warnings.push(`Line ${i + 1}: bad index "${indexRaw}" — skipped`);
      continue;
    }
    const reps = repsRaw ? parseInt(repsRaw, 10) : 1;
    if (!Number.isFinite(reps) || reps < 1 || reps > 10) {
      warnings.push(`Line ${i + 1}: reps must be 1–10, got "${repsRaw}" — skipped`);
      continue;
    }
    const ex = matchExercise(name, exercises);
    if (!ex) warnings.push(`Line ${i + 1}: no catalogue exercise matches "${name}" — map it in the wizard`);
    rows.push({ exerciseId: ex?.id ?? null, label: ex?.name ?? name, refSlot, indexPct, reps });
  }
  return { rows, warnings };
}

/** Export with `;` + decimal comma (German-Excel friendly; parse handles both). */
export function modelToCsv(rows: SollIstRow[]): string {
  const lines = ['exercise;ref;index;reps'];
  for (const r of rows) {
    const index = String(r.indexPct).replace('.', ',');
    lines.push(`${r.label};${r.refSlot === 'snatch' ? 'SN' : 'CJ'};${index};${r.reps}`);
  }
  return lines.join('\n');
}
