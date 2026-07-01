import { useRef, useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, X, CheckCircle, AlertCircle, FileSpreadsheet } from 'lucide-react';
import type { Exercise, DefaultUnit } from '../lib/database.types';
import { DEFAULT_UNITS } from '../lib/constants';
import { useExercises } from '../hooks/useExercises';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import { buildParentIndex, wouldCreateCycle } from '../lib/exerciseHierarchy';

interface ExerciseBulkImportModalProps {
  onClose: () => void;
  onComplete: () => void;
}

interface ParsedRow {
  rowNumber: number;
  data: Partial<Exercise> | null;
  errors: string[];
  /** Parent exercise referenced by code or name — resolved to an id in a second
   *  pass after all rows exist. Set-only: an empty cell never clears a parent. */
  parentRef?: string | null;
}

type ImportMode = 'merge' | 'swap';

const VALID_UNITS = DEFAULT_UNITS.map(u => u.value);

const TEMPLATE_HEADERS = [
  'name',
  'exercise_code',
  'category',
  'parent',
  'is_competition_lift',
  'default_unit',
  'color',
  'counts_towards_totals',
  'track_pr',
  'notes',
  'link',
];

const EXAMPLE_ROW = [
  'Back Squat',
  'BS',
  'Squat',
  '',
  'FALSE',
  'percentage',
  '#3B82F6',
  'TRUE',
  'FALSE',
  'Keep core tight',
  '',
];

function buildHintRow(categoryNames: string[]): string[] {
  const catHint = categoryNames.length > 0
    ? `Required. e.g. ${categoryNames.slice(0, 4).join(' / ')}${categoryNames.length > 4 ? ' / …' : ''}`
    : 'Required. e.g. Snatch / Clean & Jerk / Squat';
  return [
    'Required. Exercise name.',
    'Optional. Short code (max 10 chars). Keep stable to round-trip on Swap.',
    catHint,
    'Optional. Parent exercise by code or name — variations roll up into it. Blank keeps the current parent.',
    'Required. TRUE or FALSE',
    'Required. One of: percentage / absolute_kg / rpe / free_text / other',
    'Optional. Hex color e.g. #3B82F6. Defaults to blue if blank.',
    'Required. TRUE or FALSE',
    'Optional. TRUE or FALSE. Defaults to TRUE. Set FALSE to exclude from PR table.',
    'Optional.',
    'Optional. Video URL.',
  ];
}

function boolStr(v: boolean | null | undefined): string {
  return v === true ? 'TRUE' : v === false ? 'FALSE' : '';
}

function exerciseToRow(ex: Exercise, parentRef: string): (string | number)[] {
  return [
    ex.name ?? '',
    ex.exercise_code ?? '',
    ex.category ?? '',
    parentRef,
    boolStr(ex.is_competition_lift),
    ex.default_unit ?? '',
    ex.color ?? '',
    boolStr(ex.counts_towards_totals),
    boolStr(ex.track_pr),
    ex.notes ?? '',
    ex.link ?? '',
  ];
}

function parseBoolean(val: unknown): boolean | null {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).toLowerCase().trim();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return null;
}

function parseRow(raw: Record<string, unknown>, rowNumber: number, defaultCategory: string): ParsedRow {
  const errors: string[] = [];

  const name = String(raw['name'] ?? '').trim();
  if (!name) errors.push('name is required');

  const category = String(raw['category'] ?? '').trim() || defaultCategory;

  const unitRaw = String(raw['default_unit'] ?? '').trim().toLowerCase();
  if (!VALID_UNITS.includes(unitRaw as DefaultUnit)) {
    errors.push(`default_unit "${unitRaw}" is invalid — must be one of: ${VALID_UNITS.join(', ')}`);
  }

  const isCompRaw = parseBoolean(raw['is_competition_lift']);
  if (isCompRaw === null) errors.push('is_competition_lift must be TRUE or FALSE');

  const countsTotalsRaw = parseBoolean(raw['counts_towards_totals']);
  if (countsTotalsRaw === null) errors.push('counts_towards_totals must be TRUE or FALSE');

  // track_pr is optional — defaults to true if blank
  const trackPrRaw = raw['track_pr'] !== undefined && String(raw['track_pr']).trim() !== ''
    ? parseBoolean(raw['track_pr'])
    : true;
  if (trackPrRaw === null) errors.push('track_pr must be TRUE or FALSE');

  if (errors.length > 0) return { rowNumber, data: null, errors };

  const colorRaw = String(raw['color'] ?? '').trim();
  const color = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : '#3B82F6';

  const exerciseCode = String(raw['exercise_code'] ?? '').trim().toUpperCase().slice(0, 10) || null;
  const notes = String(raw['notes'] ?? '').trim() || null;
  const link = String(raw['link'] ?? '').trim() || null;
  const parentRef = String(raw['parent'] ?? '').trim() || null;

  return {
    rowNumber,
    errors: [],
    parentRef,
    data: {
      name,
      exercise_code: exerciseCode,
      category,
      is_competition_lift: isCompRaw!,
      default_unit: unitRaw as DefaultUnit,
      color,
      counts_towards_totals: countsTotalsRaw!,
      track_pr: trackPrRaw!,
      notes,
      link,
    },
  };
}

export function ExerciseBulkImportModal({ onClose, onComplete }: ExerciseBulkImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [hasParsed, setHasParsed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [existingExercises, setExistingExercises] = useState<Exercise[]>([]);
  const [existingLoading, setExistingLoading] = useState(true);

  const { bulkCreateExercises, createCategory, categories, fetchCategories } = useExercises();

  // Load this owner's active non-system exercises for both the template
  // round-trip (download) and the swap-mode logic (which needs to know
  // what's currently active before archiving).
  const loadExisting = useCallback(async () => {
    try {
      setExistingLoading(true);
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .eq('owner_id', getOwnerId())
        .eq('is_archived', false)
        .neq('category', '— System')
        .order('category')
        .order('name');
      if (error) throw error;
      setExistingExercises((data as Exercise[] | null) ?? []);
    } finally {
      setExistingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
    void loadExisting();
  }, [loadExisting]);

  const defaultCategory = categories[0]?.name ?? 'Snatch';

  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [
      TEMPLATE_HEADERS,
      buildHintRow(categories.map(c => c.name)),
    ];
    if (existingExercises.length > 0) {
      // Resolve each exercise's parent to a code (preferred) or name so the tree
      // round-trips through the sheet.
      const byId = new Map(existingExercises.map(e => [e.id, e]));
      const parentRefOf = (ex: Exercise): string => {
        if (!ex.parent_exercise_id) return '';
        const p = byId.get(ex.parent_exercise_id);
        return p ? (p.exercise_code || p.name) : '';
      };
      for (const ex of existingExercises) aoa.push(exerciseToRow(ex, parentRefOf(ex)));
    } else {
      aoa.push(EXAMPLE_ROW);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Column widths
    ws['!cols'] = [
      { wch: 25 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 },
      { wch: 20 }, { wch: 14 }, { wch: 24 },
      { wch: 20 }, { wch: 18 }, { wch: 30 }, { wch: 35 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Exercises');
    const filename = existingExercises.length > 0
      ? 'exercises_current.xlsx'
      : 'exercise_template.xlsx';
    XLSX.writeFile(wb, filename);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target!.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      // Skip any hint/example rows that look like instructions (no valid name)
      const dataRows = rows.filter(r => {
        const name = String(r['name'] ?? '').trim();
        return name && !name.startsWith('Required') && !name.startsWith('Optional');
      });

      const parsed = dataRows.map((r, i) => parseRow(r, i + 2, defaultCategory));
      setParsedRows(parsed);
      setHasParsed(true);
    };
    reader.readAsArrayBuffer(file);

    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const handleImport = async () => {
    const validRows = parsedRows.filter(r => r.data !== null).map(r => r.data!);
    if (validRows.length === 0) return;

    setImporting(true);
    setImportError(null);
    try {
      const ownerId = getOwnerId();

      // 1. Auto-create any categories that don't exist yet.
      const knownNames = new Set(categories.map(c => c.name));
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.display_order), -1);
      const newCatNames = [...new Set(
        validRows.map(r => r.category as string).filter(n => n && !knownNames.has(n))
      )];
      for (let i = 0; i < newCatNames.length; i++) {
        await createCategory(newCatNames[i], maxOrder + 1 + i);
      }

      // 2. Swap mode: archive every active non-system exercise first.
      //    The merge logic below will then restore + overwrite anything
      //    that's still in the incoming template, leaving the rest archived.
      if (importMode === 'swap') {
        const { error: archiveErr } = await supabase
          .from('exercises')
          .update({ is_archived: true })
          .eq('owner_id', ownerId)
          .eq('is_archived', false)
          .neq('category', '— System');
        if (archiveErr) throw archiveErr;
      }

      // 3. Fetch every existing exercise for this owner (active + archived,
      //    non-system) so we can match incoming rows by code OR name.
      const { data: existing, error: existingErr } = await supabase
        .from('exercises')
        .select('id, exercise_code, name, is_archived')
        .eq('owner_id', ownerId)
        .neq('category', '— System');
      if (existingErr) throw existingErr;

      const byCode = new Map<string, { id: string; is_archived: boolean }>();
      const byName = new Map<string, { id: string; is_archived: boolean }>();
      for (const ex of (existing as { id: string; exercise_code: string | null; name: string; is_archived: boolean }[] | null) ?? []) {
        if (ex.exercise_code) byCode.set(ex.exercise_code, { id: ex.id, is_archived: ex.is_archived });
        byName.set(ex.name.toLowerCase(), { id: ex.id, is_archived: ex.is_archived });
      }

      // 4. For each row, find a match and either restore+overwrite or queue
      //    for insert. Active conflicts (merge mode only) are skipped.
      const rowsToInsert: Partial<Exercise>[] = [];
      const activeConflicts: string[] = [];
      let restoredCount = 0;

      for (const row of validRows) {
        const code = (row.exercise_code as string | null) ?? null;
        const nameKey = (row.name as string).toLowerCase();
        const match = (code ? byCode.get(code) : null) ?? byName.get(nameKey) ?? null;

        if (!match) {
          rowsToInsert.push(row);
          continue;
        }

        if (match.is_archived) {
          const { error: restoreErr } = await supabase
            .from('exercises')
            .update({ ...row, is_archived: false })
            .eq('id', match.id)
            .eq('owner_id', ownerId);
          if (restoreErr) throw restoreErr;
          restoredCount++;
          continue;
        }

        // Active match: only possible in merge mode (swap archived everything
        // upfront). In merge mode, overwrite the existing active row in place.
        const { error: updateErr } = await supabase
          .from('exercises')
          .update(row)
          .eq('id', match.id)
          .eq('owner_id', ownerId);
        if (updateErr) {
          // Surface unique-constraint conflicts (e.g. moving code to one
          // that's already taken) as a skip rather than a hard fail.
          if (updateErr.code === '23505') {
            activeConflicts.push(code || row.name as string);
            continue;
          }
          throw updateErr;
        }
        restoredCount++;
      }

      const inserted = rowsToInsert.length > 0 ? await bulkCreateExercises(rowsToInsert) : 0;

      // 5. Second pass — resolve parent links now that every row exists. Refs
      //    match by code (preferred) or name; self/cycle-forming links are
      //    skipped via the shared guard. Set-only: blank never clears a parent.
      let parentsUnresolved = 0;
      let parentsCyclic = 0;
      const parentRows = parsedRows.filter(r => r.data && r.parentRef);
      if (parentRows.length > 0) {
        const { data: allNow, error: allErr } = await supabase
          .from('exercises')
          .select('id, exercise_code, name, parent_exercise_id')
          .eq('owner_id', ownerId)
          .neq('category', '— System');
        if (allErr) throw allErr;
        const list = (allNow as { id: string; exercise_code: string | null; name: string; parent_exercise_id: string | null }[] | null) ?? [];
        const byCode2 = new Map<string, (typeof list)[number]>();
        const byName2 = new Map<string, (typeof list)[number]>();
        for (const e of list) {
          if (e.exercise_code) byCode2.set(e.exercise_code, e);
          byName2.set(e.name.toLowerCase(), e);
        }
        const resolveRef = (ref: string) =>
          byCode2.get(ref.trim().toUpperCase()) ?? byName2.get(ref.trim().toLowerCase()) ?? null;
        const idx = buildParentIndex(list.map(e => ({ id: e.id, parent_exercise_id: e.parent_exercise_id })));

        for (const r of parentRows) {
          const childCode = (r.data!.exercise_code as string | null) ?? null;
          const child = (childCode ? byCode2.get(childCode) : null)
            ?? byName2.get((r.data!.name as string).toLowerCase()) ?? null;
          const parent = resolveRef(r.parentRef!);
          if (!child || !parent || child.id === parent.id) { parentsUnresolved++; continue; }
          if (wouldCreateCycle(child.id, parent.id, idx)) { parentsCyclic++; continue; }
          const { error: pErr } = await supabase
            .from('exercises')
            .update({ parent_exercise_id: parent.id })
            .eq('id', child.id)
            .eq('owner_id', ownerId);
          if (pErr) throw pErr;
          idx.set(child.id, parent.id);
        }
      }

      const summaryBits: string[] = [];
      if (parentsUnresolved > 0) summaryBits.push(`${parentsUnresolved} parent link(s) could not be resolved`);
      if (parentsCyclic > 0) summaryBits.push(`${parentsCyclic} parent link(s) skipped (would create a cycle)`);
      if (importMode === 'swap') {
        const archivedNotInTemplate = existingExercises.length - restoredCount;
        if (archivedNotInTemplate > 0) {
          summaryBits.push(`${archivedNotInTemplate} exercise${archivedNotInTemplate === 1 ? '' : 's'} archived (not in template)`);
        }
      }
      if (activeConflicts.length > 0) {
        summaryBits.push(`Skipped ${activeConflicts.length} row(s) — code already in use: ${activeConflicts.join(', ')}`);
      }
      if (summaryBits.length > 0) setImportError(summaryBits.join(' · '));
      setImportResult(inserted + restoredCount);
    } catch (err) {
      console.error('Bulk import failed:', err);
      const msg = err instanceof Error
        ? err.message
        : (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
          ? (err as { message: string }).message
          : 'Import failed';
      setImportError(msg);
    } finally {
      setImporting(false);
    }
  };

  const validRows = parsedRows.filter(r => r.data !== null);
  const invalidRows = parsedRows.filter(r => r.data === null);
  const knownCategoryNames = new Set(categories.map(c => c.name));
  const newCategoryNames = [...new Set(
    validRows.map(r => r.data!.category as string).filter(n => n && !knownCategoryNames.has(n))
  )];

  if (importResult !== null) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="rounded-lg max-w-md w-full p-8 text-center" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
          <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Import complete</h2>
          <p className="text-gray-600 mb-2">{importResult} exercise{importResult !== 1 ? 's' : ''} imported successfully.</p>
          {importError && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4 text-left">
              {importError}
            </p>
          )}
          <button
            onClick={onComplete}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Import Exercises from Excel</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Step 1: Download template */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-bold flex items-center justify-center">1</span>
              Download the template
            </h3>
            <p className="text-sm text-gray-600">
              {existingLoading
                ? 'Preparing template…'
                : existingExercises.length > 0
                  ? <>The template is pre-filled with your <span className="font-medium">{existingExercises.length}</span> existing exercise{existingExercises.length === 1 ? '' : 's'}. Edit, add, or remove rows in Excel and re-upload.</>
                  : 'Fill in the template with your exercises.'}
            </p>
            <p className="text-xs text-gray-500">
              Required fields: <span className="font-medium">name, category, is_competition_lift, default_unit, counts_towards_totals</span>.
            </p>
            <button
              onClick={handleDownloadTemplate}
              disabled={existingLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              {existingExercises.length > 0 ? 'Download current catalogue (.xlsx)' : 'Download Template (.xlsx)'}
            </button>
          </div>

          {/* Step 2: Upload */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-bold flex items-center justify-center">2</span>
              Upload your filled template
            </h3>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              <Upload size={16} />
              Choose Excel file
            </button>
          </div>

          {/* Step 3: Preview + mode + import */}
          {hasParsed && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <h3 className="font-medium text-gray-900 flex items-center gap-2">
                <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-bold flex items-center justify-center">3</span>
                Preview &amp; choose mode
              </h3>

              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1 text-green-700 font-medium">
                  <CheckCircle size={14} /> {validRows.length} valid
                </span>
                {invalidRows.length > 0 && (
                  <span className="flex items-center gap-1 text-red-600 font-medium">
                    <AlertCircle size={14} /> {invalidRows.length} invalid
                  </span>
                )}
              </div>

              {newCategoryNames.length > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  New {newCategoryNames.length === 1 ? 'category' : 'categories'} will be created: <span className="font-medium">{newCategoryNames.join(', ')}</span>
                </p>
              )}

              {importError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {importError}
                </p>
              )}

              {/* Mode selector */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-700">How should this import be applied?</div>
                <div className="grid grid-cols-2 gap-2">
                  <label
                    className={`cursor-pointer rounded-lg border p-3 text-sm ${
                      importMode === 'merge'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value="merge"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                      className="mr-2"
                    />
                    <span className="font-medium text-gray-900">Merge</span>
                    <div className="mt-1 text-xs text-gray-600">
                      Add or update exercises in the template. Existing exercises not in the template are kept as-is.
                    </div>
                  </label>
                  <label
                    className={`cursor-pointer rounded-lg border p-3 text-sm ${
                      importMode === 'swap'
                        ? 'border-red-500 bg-red-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value="swap"
                      checked={importMode === 'swap'}
                      onChange={() => setImportMode('swap')}
                      className="mr-2"
                    />
                    <span className="font-medium text-gray-900">Swap</span>
                    <div className="mt-1 text-xs text-gray-600">
                      Archive every existing exercise first, then import the template. Exercises not in the template will be hidden but recoverable.
                    </div>
                  </label>
                </div>
              </div>

              {parsedRows.length > 0 && (
                <div className="max-h-52 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100 text-sm">
                  {parsedRows.map(row => (
                    <div
                      key={row.rowNumber}
                      className={`px-3 py-2 flex items-start gap-2 ${row.data ? 'bg-green-50' : 'bg-red-50'}`}
                    >
                      {row.data ? (
                        <CheckCircle size={14} className="text-green-600 mt-0.5 flex-shrink-0" />
                      ) : (
                        <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <span className="font-medium text-gray-800">
                          Row {row.rowNumber}{row.data?.name ? `: ${row.data.name}` : ''}
                        </span>
                        {row.errors.length > 0 && (
                          <ul className="mt-0.5 space-y-0.5">
                            {row.errors.map((e, i) => (
                              <li key={i} className="text-red-600 text-xs">{e}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          {hasParsed && validRows.length > 0 && (
            <button
              onClick={handleImport}
              disabled={importing}
              className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                importMode === 'swap'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {importing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  {importMode === 'swap' ? `Swap to ${validRows.length} exercise${validRows.length !== 1 ? 's' : ''}` : `Merge ${validRows.length} exercise${validRows.length !== 1 ? 's' : ''}`}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
