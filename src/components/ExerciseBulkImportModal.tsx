import { useRef, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Download, Upload, X, CheckCircle, AlertCircle, FileSpreadsheet } from 'lucide-react';
import type { Exercise, DefaultUnit } from '../lib/database.types';
import { DEFAULT_UNITS } from '../lib/constants';
import { useExercises } from '../hooks/useExercises';

interface ExerciseBulkImportModalProps {
  onClose: () => void;
  onComplete: () => void;
}

interface ParsedRow {
  rowNumber: number;
  data: Partial<Exercise> | null;
  errors: string[];
}

const VALID_UNITS = DEFAULT_UNITS.map(u => u.value);

const TEMPLATE_HEADERS = [
  'name',
  'exercise_code',
  'category',
  'is_competition_lift',
  'default_unit',
  'color',
  'counts_towards_totals',
  'use_stacked_notation',
  'notes',
  'link',
];

const EXAMPLE_ROW = [
  'Back Squat',
  'BS',
  'Squat',
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
    'Optional. Short code (max 10 chars).',
    catHint,
    'Required. TRUE or FALSE',
    'Required. One of: percentage / absolute_kg / rpe / free_text / other',
    'Optional. Hex color e.g. #3B82F6. Defaults to blue if blank.',
    'Required. TRUE or FALSE',
    'Required. TRUE or FALSE',
    'Optional.',
    'Optional. Video URL.',
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

  const stackedRaw = parseBoolean(raw['use_stacked_notation']);
  if (stackedRaw === null) errors.push('use_stacked_notation must be TRUE or FALSE');

  if (errors.length > 0) return { rowNumber, data: null, errors };

  const colorRaw = String(raw['color'] ?? '').trim();
  const color = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : '#3B82F6';

  const exerciseCode = String(raw['exercise_code'] ?? '').trim().toUpperCase().slice(0, 10) || null;
  const notes = String(raw['notes'] ?? '').trim() || null;
  const link = String(raw['link'] ?? '').trim() || null;

  return {
    rowNumber,
    errors: [],
    data: {
      name,
      exercise_code: exerciseCode,
      category,
      is_competition_lift: isCompRaw!,
      default_unit: unitRaw as DefaultUnit,
      color,
      counts_towards_totals: countsTotalsRaw!,
      use_stacked_notation: stackedRaw!,
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

  const { bulkCreateExercises, categories, fetchCategories } = useExercises();

  useEffect(() => { fetchCategories(); }, []);

  const defaultCategory = categories[0]?.name ?? 'Snatch';

  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, buildHintRow(categories.map(c => c.name)), EXAMPLE_ROW]);

    // Column widths
    ws['!cols'] = [
      { wch: 25 }, { wch: 14 }, { wch: 20 }, { wch: 22 },
      { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 22 },
      { wch: 30 }, { wch: 35 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Exercises');
    XLSX.writeFile(wb, 'exercise_template.xlsx');
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
    try {
      const count = await bulkCreateExercises(validRows);
      setImportResult(count);
    } catch {
      // error shown via hook
    } finally {
      setImporting(false);
    }
  };

  const validRows = parsedRows.filter(r => r.data !== null);
  const invalidRows = parsedRows.filter(r => r.data === null);

  if (importResult !== null) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="rounded-lg max-w-md w-full p-8 text-center" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
          <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Import complete</h2>
          <p className="text-gray-600 mb-6">{importResult} exercise{importResult !== 1 ? 's' : ''} imported successfully.</p>
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
              Fill in the template with your exercises. Required fields: <span className="font-medium">name, category, is_competition_lift, default_unit, counts_towards_totals, use_stacked_notation</span>.
            </p>
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
            >
              <Download size={16} />
              Download Template (.xlsx)
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

          {/* Step 3: Preview */}
          {hasParsed && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <h3 className="font-medium text-gray-900 flex items-center gap-2">
                <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-bold flex items-center justify-center">3</span>
                Preview
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
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {importing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Import {validRows.length} exercise{validRows.length !== 1 ? 's' : ''}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
