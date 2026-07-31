/**
 * sollIstCsv — import/export of Soll–Ist reference models as CSV, so a coach
 * can maintain templates in a spreadsheet and load them into EMOS.
 *
 * Format (header optional, delimiter `;` or `,` auto-detected):
 *
 *   exercise;ref;index;reps
 *   Back squat;CJ;120;3
 *   Snatch pull;SN;108;1
 *   Overhead squat;Back squat;65;1
 *
 * `ref` is the *name* of a reference — rows sharing a name share a
 * reference, and references are created on the fly, so a template can use
 * any exercise (or any label) as its index-100 anchor. The classic aliases
 * SN / CJ / 1 / 2 (Kategorie 1 = snatch, 2 = C&J, matching the
 * Trainingsmittelkatalog companion sheet) map to "Snatch" / "Clean & Jerk".
 * Decimal commas are accepted in the index column when the delimiter is `;`
 * (German-Excel exports).
 */
import type { Exercise } from './database.types';
import { newRefKey, type SollIstRef, type SollIstRow } from './sollIst';

export interface CsvParseResult {
  refs: SollIstRef[];
  rows: SollIstRow[];
  /** Human-readable problems (unmatched exercise, bad number …). */
  warnings: string[];
}

/** Canonical label for the classic Kategorie aliases; null = use as typed. */
function canonicalRefLabel(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v === 'sn' || v === 'snatch' || v === '1' || v === 'k1') return 'Snatch';
  if (v === 'cj' || v === 'c&j' || v === 'clean_and_jerk' || v === 'clean and jerk' || v === '2' || v === 'k2') return 'Clean & Jerk';
  return raw.trim();
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
  const refs: SollIstRef[] = [];
  const rows: SollIstRow[] = [];
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { refs, rows, warnings: ['File is empty'] };

  // Delimiter: ';' wins when present (German Excel), else ','.
  const delim = lines[0].includes(';') ? ';' : ',';

  const refByLabel = new Map<string, SollIstRef>();
  const refFor = (rawLabel: string): SollIstRef => {
    const label = canonicalRefLabel(rawLabel);
    const lower = label.toLowerCase();
    const existing = refByLabel.get(lower);
    if (existing) return existing;
    // References bind by EXACT name only — a loosely-bound anchor (e.g.
    // "Snatch" grabbing "Snatch pull") would corrupt every row pointing at
    // it. An unbound ref is still fully usable as a manual reference.
    const ex = exercises.find((e) => e.name.toLowerCase() === lower) ?? null;
    const ref: SollIstRef = {
      key: newRefKey(label, refs.map((r) => r.key)),
      label: ex?.name ?? label,
      exerciseId: ex?.id ?? null,
    };
    refs.push(ref);
    refByLabel.set(lower, ref);
    return ref;
  };

  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(delim).map((c) => c.trim());
    if (i === 0 && /exercise/i.test(cells[0] ?? '')) continue; // header
    if (cells.length < 3) {
      warnings.push(`Line ${i + 1}: expected exercise${delim}ref${delim}index[${delim}reps] — skipped`);
      continue;
    }
    const [name, refRaw, indexRaw, repsRaw] = cells;
    if (!refRaw) {
      warnings.push(`Line ${i + 1}: empty reference — skipped`);
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
    const ref = refFor(refRaw);
    const ex = matchExercise(name, exercises);
    if (!ex) warnings.push(`Line ${i + 1}: no catalogue exercise matches "${name}" — map it in the wizard`);
    rows.push({ exerciseId: ex?.id ?? null, label: ex?.name ?? name, refKey: ref.key, indexPct, reps });
  }
  return { refs, rows, warnings };
}

/** Export with `;` + decimal comma (German-Excel friendly; parse handles both). */
export function modelToCsv(refs: SollIstRef[], rows: SollIstRow[]): string {
  const labelOf = new Map(refs.map((r) => [r.key, r.label]));
  const lines = ['exercise;ref;index;reps'];
  for (const r of rows) {
    const index = String(r.indexPct).replace('.', ',');
    lines.push(`${r.label};${labelOf.get(r.refKey) ?? r.refKey};${index};${r.reps}`);
  }
  return lines.join('\n');
}
