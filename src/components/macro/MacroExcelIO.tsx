import { useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { MacroWeek, MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise } from '../../lib/database.types';
import { formatDateShort } from '../../lib/dateUtils';

interface MacroExcelIOProps {
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  phases: MacroPhase[];
  cycleNameForFile: string;
  onImportTargets: (rows: { weekId: string; trackedExId: string; field: keyof MacroTarget; value: number }[]) => Promise<void>;
}

const TARGET_FIELDS: Array<{ field: keyof MacroTarget; label: string }> = [
  { field: 'target_reps', label: 'Target Reps' },
  { field: 'target_ave', label: 'Target Ave (kg)' },
  { field: 'target_hi', label: 'Target Hi (kg)' },
  { field: 'target_rhi', label: 'Target RHi' },
  { field: 'target_shi', label: 'Target SHi' },
];

interface ImportRow {
  weekNumber: number;
  weekId: string;
  trackedExId: string;
  exerciseName: string;
  field: keyof MacroTarget;
  value: number;
  valid: boolean;
  error?: string;
}

export function MacroExcelIO({
  macroWeeks,
  trackedExercises,
  targets,
  phases,
  cycleNameForFile,
  onImportTargets,
}: MacroExcelIOProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  // GROUP WEEKS BY PHASE
  const getPhaseForWeek = (week: MacroWeek): MacroPhase | null => {
    return phases.find(p =>
      week.week_number >= p.start_week_number && week.week_number <= p.end_week_number
    ) ?? null;
  };

  const handleExport = () => {
    const wb = XLSX.utils.book_new();

    // Group weeks by phase (+ unassigned)
    const phaseGroups = new Map<string, { phase: MacroPhase | null; weeks: MacroWeek[] }>();

    for (const week of macroWeeks) {
      const phase = getPhaseForWeek(week);
      const key = phase?.id ?? '__unassigned__';
      if (!phaseGroups.has(key)) phaseGroups.set(key, { phase, weeks: [] });
      phaseGroups.get(key)!.weeks.push(week);
    }

    phaseGroups.forEach(({ phase, weeks }) => {
      const sheetName = phase
        ? phase.name.replace(/[:/\\?*[\]]/g, '').substring(0, 31)
        : 'Unassigned';

      // Build header rows
      const headerRow1: string[] = ['Wk', 'Date', 'Type', 'Label', 'Total Reps Target'];
      const headerRow2: string[] = ['', '', '', '', ''];

      trackedExercises.forEach(te => {
        const exName = te.exercise.exercise_code || te.exercise.name;
        TARGET_FIELDS.forEach((f, fi) => {
          if (fi === 0) headerRow1.push(exName);
          else headerRow1.push('');
          headerRow2.push(f.label);
        });
      });

      const rows: (string | number | null)[][] = [headerRow1, headerRow2];

      weeks.forEach(week => {
        const row: (string | number | null)[] = [
          week.week_number,
          formatDateShort(week.week_start),
          week.week_type,
          week.week_type_text || '',
          week.total_reps_target ?? '',
        ];
        trackedExercises.forEach(te => {
          const target = targets.find(t => t.macro_week_id === week.id && t.tracked_exercise_id === te.id);
          TARGET_FIELDS.forEach(f => {
            row.push(target?.[f.field] as number ?? null);
          });
        });
        rows.push(row);
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // Column widths
      const colWidths = [
        { wch: 4 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
        ...trackedExercises.flatMap(() => TARGET_FIELDS.map(() => ({ wch: 12 }))),
      ];
      ws['!cols'] = colWidths;

      // Merge exercise header cells (span 5 columns each)
      const merges: XLSX.Range[] = [];
      trackedExercises.forEach((_, idx) => {
        const startCol = 5 + idx * 5;
        merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + 4 } });
      });
      if (merges.length > 0) ws['!merges'] = merges;

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const filename = `${cycleNameForFile.replace(/[^a-z0-9_-]/gi, '_')}_macro.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });
        const parsed: ImportRow[] = [];

        // Build lookup maps
        const weekByNumber = new Map(macroWeeks.map(w => [w.week_number, w]));
        const teByExCode = new Map(trackedExercises.map(te => [
          (te.exercise.exercise_code || te.exercise.name).toLowerCase(), te
        ]));

        wb.SheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1 }) as unknown[][];
          if (rows.length < 3) return;

          const exHeaderRow = rows[0] as (string | null)[];
          const fieldHeaderRow = rows[1] as (string | null)[];

          // Map column index → { trackedExId, field }
          const colMap = new Map<number, { te: MacroTrackedExerciseWithExercise; field: keyof MacroTarget }>();
          let currentTe: MacroTrackedExerciseWithExercise | null = null;
          exHeaderRow.forEach((cell, colIdx) => {
            if (colIdx < 5) return;
            const cellStr = String(cell ?? '').trim();
            if (cellStr) currentTe = teByExCode.get(cellStr.toLowerCase()) ?? null;
            if (currentTe) {
              const fieldLabel = String(fieldHeaderRow[colIdx] ?? '').trim();
              const fieldDef = TARGET_FIELDS.find(f => f.label === fieldLabel);
              if (fieldDef) colMap.set(colIdx, { te: currentTe, field: fieldDef.field });
            }
          });

          // Process data rows (from row index 2 onwards)
          for (let ri = 2; ri < rows.length; ri++) {
            const row = rows[ri] as (string | number | null)[];
            const weekNum = Number(row[0]);
            if (!weekNum || isNaN(weekNum)) continue;
            const week = weekByNumber.get(weekNum);
            if (!week) {
              colMap.forEach(({ te, field }) => {
                parsed.push({
                  weekNumber: weekNum,
                  weekId: '',
                  trackedExId: te.id,
                  exerciseName: te.exercise.exercise_code || te.exercise.name,
                  field,
                  value: 0,
                  valid: false,
                  error: `Week ${weekNum} not found in macrocycle`,
                });
              });
              continue;
            }

            colMap.forEach(({ te, field }, colIdx) => {
              const rawVal = row[colIdx];
              const numVal = rawVal !== null && rawVal !== undefined && rawVal !== '' ? Number(rawVal) : null;
              if (numVal === null) return; // Skip empty cells
              if (isNaN(numVal as number) || (numVal as number) < 0) {
                parsed.push({
                  weekNumber: weekNum,
                  weekId: week.id,
                  trackedExId: te.id,
                  exerciseName: te.exercise.exercise_code || te.exercise.name,
                  field,
                  value: 0,
                  valid: false,
                  error: `Invalid value: ${rawVal}`,
                });
              } else {
                parsed.push({
                  weekNumber: weekNum,
                  weekId: week.id,
                  trackedExId: te.id,
                  exerciseName: te.exercise.exercise_code || te.exercise.name,
                  field,
                  value: numVal as number,
                  valid: true,
                });
              }
            });
          }
        });

        setImportRows(parsed);
        setImportDone(false);
        setShowImportModal(true);
      } catch (err) {
        alert(`Failed to parse file: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsBinaryString(file);
  };

  const validRows = importRows.filter(r => r.valid);
  const invalidRows = importRows.filter(r => !r.valid);

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      await onImportTargets(validRows.map(r => ({
        weekId: r.weekId,
        trackedExId: r.trackedExId,
        field: r.field,
        value: r.value,
      })));
      setImportDone(true);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Download size={13} />
          Export Excel
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Upload size={13} />
          Import Excel
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-sm font-semibold text-gray-900">Import Targets from Excel</h2>
              <button onClick={() => setShowImportModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {importDone ? (
                <div className="text-center py-8">
                  <div className="text-green-600 text-sm font-medium mb-1">
                    {validRows.length} target{validRows.length !== 1 ? 's' : ''} imported successfully.
                  </div>
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="mt-3 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 mb-4 text-xs">
                    <span className="text-green-700 font-medium">{validRows.length} valid rows</span>
                    {invalidRows.length > 0 && (
                      <span className="text-red-600 font-medium">{invalidRows.length} errors</span>
                    )}
                  </div>

                  {importRows.length === 0 ? (
                    <p className="text-xs text-gray-400">No data found in file.</p>
                  ) : (
                    <div className="border border-gray-200 rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Wk</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Exercise</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Field</th>
                            <th className="px-3 py-2 text-right font-medium text-gray-600">Value</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importRows.slice(0, 200).map((row, i) => (
                            <tr key={i} className={row.valid ? 'bg-white' : 'bg-red-50'}>
                              <td className="px-3 py-1.5 text-gray-700">{row.weekNumber}</td>
                              <td className="px-3 py-1.5 text-gray-700">{row.exerciseName}</td>
                              <td className="px-3 py-1.5 text-gray-500">
                                {TARGET_FIELDS.find(f => f.field === row.field)?.label ?? row.field}
                              </td>
                              <td className="px-3 py-1.5 text-right text-gray-700">{row.valid ? row.value : '—'}</td>
                              <td className="px-3 py-1.5">
                                {row.valid
                                  ? <span className="text-green-600">✓</span>
                                  : <span className="text-red-600">{row.error}</span>
                                }
                              </td>
                            </tr>
                          ))}
                          {importRows.length > 200 && (
                            <tr>
                              <td colSpan={5} className="px-3 py-2 text-center text-gray-400">
                                … and {importRows.length - 200} more rows
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {!importDone && (
              <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0">
                <button
                  onClick={() => setShowImportModal(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={validRows.length === 0 || importing}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {importing ? 'Importing…' : `Import ${validRows.length} rows`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
