import { useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { MacroWeek, MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise, Exercise } from '../../lib/database.types';
import { formatDateShort } from '../../lib/dateUtils';
import { supabase } from '../../lib/supabase';
import { PlanningPRPanel } from './PlanningPRPanel';

interface MacroExcelIOProps {
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  phases: MacroPhase[];
  actuals?: import('../../hooks/useMacroCycles').MacroActualsMap;  // for enhanced export
  cycleNameForFile: string;
  cycleDateRange?: { start: string; end: string };   // for summary sheet
  athleteName?: string;            // for summary sheet
  athleteId?: string | null;       // for fetching PRs (null for group macros)
  onImportTargets: (rows: { weekId: string; trackedExId: string; field: keyof MacroTarget; value: number }[]) => Promise<void>;
}

const TARGET_FIELDS: Array<{ field: keyof MacroTarget; label: string }> = [
  { field: 'target_reps', label: 'Target Reps' },
  { field: 'target_avg', label: 'Target Avg (kg)' },
  { field: 'target_max', label: 'Target Hi (kg)' },
  { field: 'target_reps_at_max', label: 'Target RMax' },
  { field: 'target_sets_at_max', label: 'Target SMax' },
];

// Template-specific field labels (percentage-based)
const TEMPLATE_FIELDS: Array<{ field: keyof MacroTarget; label: string; isPercent: boolean }> = [
  { field: 'target_reps', label: 'Target Reps', isPercent: false },
  { field: 'target_avg', label: 'Target Avg%', isPercent: true },
  { field: 'target_max', label: 'Target Hi%', isPercent: true },
  { field: 'target_reps_at_max', label: 'Target RMax', isPercent: false },
  { field: 'target_sets_at_max', label: 'Target SMax', isPercent: false },
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

// For template import: parsed data before resolution
interface TemplateWeekData {
  weekNumber: number;
  weekType: string;
  weekLabel: string;
  totalReps: number | null;
  exerciseData: Record<string, Record<keyof MacroTarget, number | null>>; // exerciseCode → field → value
}

interface TemplateData {
  name: string;
  unit: 'percentage' | 'absolute';
  exercises: string[];          // exercise codes from template
  weeks: TemplateWeekData[];
}

/**
 * Resolve a percentage target to absolute kg using planning PRs.
 */
function resolvePercentage(
  percentage: number,
  exerciseId: string,
  planningPRs: Map<string, number>,
  prReferences: Map<string, string>,
): number | null {
  const refId = prReferences.get(exerciseId) ?? exerciseId;
  const pr = planningPRs.get(refId);
  if (!pr) return null;
  return Math.round(pr * percentage / 100);
}

export function MacroExcelIO({
  macroWeeks,
  trackedExercises,
  targets,
  phases,
  actuals,
  cycleNameForFile,
  cycleDateRange,
  athleteName,
  athleteId,
  onImportTargets,
}: MacroExcelIOProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  // Template import state
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateData, setTemplateData] = useState<TemplateData | null>(null);
  const [templateFilename, setTemplateFilename] = useState('');

  // Exercise mapping: templateCode → exercise from library
  const [exerciseMapping, setExerciseMapping] = useState<Map<string, string>>(new Map()); // code → exerciseId

  // Planning PRs for resolution
  const [planningPRs, setPlanningPRs] = useState<Map<string, number>>(new Map()); // exerciseId → planning PR kg
  const [currentPRs, setCurrentPRs] = useState<Map<string, number>>(new Map()); // exerciseId → current PR (read-only)
  const [prReferences, setPrReferences] = useState<Map<string, string>>(new Map()); // exerciseId → ref exerciseId

  // All exercises in the library (for mapping dropdown)
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);

  // Template import options
  const [updatePRsAfterImport, setUpdatePRsAfterImport] = useState(false);
  const [templateImporting, setTemplateImporting] = useState(false);
  const [templateImportDone, setTemplateImportDone] = useState(false);

  // GROUP WEEKS BY PHASE
  const getPhaseForWeek = (week: MacroWeek): MacroPhase | null => {
    return phases.find(p =>
      week.week_number >= p.start_week_number && week.week_number <= p.end_week_number
    ) ?? null;
  };

  // ─── EXPORT EXCEL ────────────────────────────────────────────────────────────

  const buildExportWorkbook = (asTemplate: boolean, athletePRs?: Map<string, number>) => {
    const wb = XLSX.utils.book_new();

    if (asTemplate) {
      // Template Info sheet
      const infoRows = [
        ['Template name:', cycleNameForFile],
        ['Duration:', `${macroWeeks.length} weeks`],
        ['Unit:', 'percentage'],
        ['Exercises:', trackedExercises.map(te => te.exercise.exercise_code || te.exercise.name).join(', ')],
        ['Generated:', new Date().toISOString().split('T')[0]],
      ];
      const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
      wsInfo['!cols'] = [{ wch: 18 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, wsInfo, 'Template Info');
    } else {
      // ─── Summary sheet ───
      const summaryRows: (string | number | null)[][] = [];
      summaryRows.push(['Macrocycle:', cycleNameForFile]);
      if (athleteName) summaryRows.push(['Athlete:', athleteName]);
      if (cycleDateRange) {
        summaryRows.push(['Start:', cycleDateRange.start]);
        summaryRows.push(['End:', cycleDateRange.end]);
      }
      summaryRows.push(['Duration:', `${macroWeeks.length} weeks`]);
      summaryRows.push([]);

      if (phases.length > 0) {
        summaryRows.push(['Phase overview:']);
        phases.forEach(phase => {
          summaryRows.push([`  ${phase.name} (weeks ${phase.start_week_number}–${phase.end_week_number}):`, phase.notes || phase.phase_type]);
        });
        summaryRows.push([]);
      }

      summaryRows.push(['Weekly totals:']);
      summaryRows.push(['Week', 'Date', 'Type', 'Target Reps', 'Actual Reps']);
      macroWeeks.forEach(week => {
        const weekActuals = actuals?.[week.id] ?? {};
        const actualReps = Object.values(weekActuals).reduce((sum, a) => sum + a.totalReps, 0);
        summaryRows.push([
          week.week_number,
          formatDateShort(week.week_start),
          week.week_type,
          week.total_reps_target ?? '',
          actualReps > 0 ? actualReps : '',
        ]);
      });

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
      wsSummary['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    }

    const phaseGroups = new Map<string, { phase: MacroPhase | null; weeks: MacroWeek[] }>();
    for (const week of macroWeeks) {
      const phase = getPhaseForWeek(week);
      const key = phase?.id ?? '__unassigned__';
      if (!phaseGroups.has(key)) phaseGroups.set(key, { phase, weeks: [] });
      phaseGroups.get(key)!.weeks.push(week);
    }

    const fieldDefs = asTemplate ? TEMPLATE_FIELDS : TARGET_FIELDS.map(f => ({ ...f, isPercent: false }));

    phaseGroups.forEach(({ phase, weeks }) => {
      const sheetName = phase
        ? phase.name.replace(/[:/\\?*[\]]/g, '').substring(0, 31)
        : 'Unassigned';

      const headerRow1: string[] = ['Wk', 'Date', 'Type', 'Label', 'Total Reps'];
      const headerRow2: string[] = ['', '', '', '', ''];

      trackedExercises.forEach(te => {
        const exName = te.exercise.exercise_code || te.exercise.name;
        if (!asTemplate) {
          // Target + Actual columns (5 each = 10 per exercise)
          fieldDefs.forEach((f, fi) => {
            if (fi === 0) headerRow1.push(`${exName} (Target)`);
            else headerRow1.push('');
            headerRow2.push(f.label);
          });
          fieldDefs.forEach((f, fi) => {
            if (fi === 0) headerRow1.push(`${exName} (Actual)`);
            else headerRow1.push('');
            headerRow2.push(f.label.replace('Target ', ''));
          });
        } else {
          fieldDefs.forEach((f, fi) => {
            if (fi === 0) headerRow1.push(exName);
            else headerRow1.push('');
            headerRow2.push(f.label);
          });
        }
      });

      const rows: (string | number | null)[][] = [headerRow1, headerRow2];

      weeks.forEach(week => {
        const weekActuals = actuals?.[week.id] ?? {};
        const row: (string | number | null)[] = [
          week.week_number,
          formatDateShort(week.week_start),
          week.week_type,
          week.week_type_text || '',
          week.total_reps_target ?? '',
        ];
        trackedExercises.forEach(te => {
          const target = targets.find(t => t.macro_week_id === week.id && t.tracked_exercise_id === te.id);
          const exActuals = weekActuals[te.exercise_id];
          fieldDefs.forEach(f => {
            let val = target?.[f.field] as number | null ?? null;
            if (asTemplate && f.isPercent && val !== null) {
              const pr = athletePRs?.get(te.exercise_id);
              if (pr && pr > 0) {
                val = Math.round((val / pr) * 100);
              }
            }
            row.push(val);
          });
          if (!asTemplate) {
            // Actual values alongside targets
            const actualValues: (number | null)[] = exActuals
              ? [exActuals.totalReps, exActuals.avgWeight, exActuals.maxWeight, exActuals.repsAtMax, exActuals.setsAtMax]
              : [null, null, null, null, null];
            actualValues.forEach(v => row.push(v && v > 0 ? v : null));
          }
        });
        rows.push(row);
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);

      const colsPerEx = asTemplate ? fieldDefs.length : fieldDefs.length * 2;
      const colWidths = [
        { wch: 4 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
        ...trackedExercises.flatMap(() => Array(colsPerEx).fill({ wch: 12 })),
      ];
      ws['!cols'] = colWidths;

      const merges: XLSX.Range[] = [];
      trackedExercises.forEach((_, idx) => {
        const startCol = 5 + idx * colsPerEx;
        merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + fieldDefs.length - 1 } });
        if (!asTemplate) {
          merges.push({ s: { r: 0, c: startCol + fieldDefs.length }, e: { r: 0, c: startCol + colsPerEx - 1 } });
        }
      });
      if (merges.length > 0) ws['!merges'] = merges;

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    return wb;
  };

  const handleExport = () => {
    const wb = buildExportWorkbook(false);
    const filename = `${cycleNameForFile.replace(/[^a-z0-9_-]/gi, '_')}_macro.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const handleExportTemplate = async () => {
    let athletePRs: Map<string, number> | undefined;

    if (athleteId) {
      const exerciseIds = trackedExercises.map(te => te.exercise_id);
      const { data: prs } = await supabase
        .from('athlete_prs')
        .select('exercise_id, pr_value_kg')
        .eq('athlete_id', athleteId)
        .in('exercise_id', exerciseIds);

      athletePRs = new Map<string, number>();
      (prs || []).forEach(pr => {
        if (pr.pr_value_kg) athletePRs!.set(pr.exercise_id, pr.pr_value_kg);
      });
    }

    const wb = buildExportWorkbook(true, athletePRs);
    const filename = `${cycleNameForFile.replace(/[^a-z0-9_-]/gi, '_')}_template.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  // ─── IMPORT EXCEL ─────────────────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });

        // Check if it's a template file
        const isTemplate = wb.SheetNames.includes('Template Info');
        if (isTemplate) {
          alert('This looks like a template file. Use "Import Template" button instead.');
          return;
        }

        const parsed: ImportRow[] = [];
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
              if (numVal === null) return;
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

  // ─── TEMPLATE IMPORT ─────────────────────────────────────────────────────────

  const handleTemplateFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setTemplateFilename(file.name);

    // Load all exercises for mapping
    const { data: exercises } = await supabase
      .from('exercises')
      .select('*')
      .order('name');
    setAllExercises(exercises || []);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = ev.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });

        if (!wb.SheetNames.includes('Template Info')) {
          alert('This does not appear to be a template file. Use "Import Excel" for regular imports.');
          return;
        }

        // Parse Template Info sheet
        const infoWs = wb.Sheets['Template Info'];
        const infoRows = XLSX.utils.sheet_to_json<unknown[]>(infoWs, { header: 1 }) as unknown[][];
        const templateName = String(infoRows.find((r: unknown[]) => String(r[0]).includes('Template name'))?.[1] ?? file.name.replace('.xlsx', ''));
        const templateUnit = (String(infoRows.find((r: unknown[]) => String(r[0]).includes('Unit'))?.[1] ?? 'percentage').toLowerCase()) as 'percentage' | 'absolute';
        const exercisesStr = String(infoRows.find((r: unknown[]) => String(r[0]).includes('Exercises'))?.[1] ?? '');
        const templateExerciseCodes = exercisesStr.split(',').map(s => s.trim()).filter(Boolean);

        // Parse data sheets
        const dataSheetNames = wb.SheetNames.filter(n => n !== 'Template Info');
        const parsedWeeks: TemplateWeekData[] = [];

        dataSheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];
          if (rows.length < 3) return;

          const exHeaderRow = rows[0] as (string | null)[];
          const fieldHeaderRow = rows[1] as (string | null)[];

          // Build col → { exerciseCode, field }
          const colMap = new Map<number, { exCode: string; field: keyof MacroTarget; isPercent: boolean }>();
          let currentExCode = '';
          exHeaderRow.forEach((cell, colIdx) => {
            if (colIdx < 5) return;
            const cellStr = String(cell ?? '').trim();
            if (cellStr) currentExCode = cellStr;
            if (currentExCode) {
              const fieldLabel = String(fieldHeaderRow[colIdx] ?? '').trim();
              const fieldDef = TEMPLATE_FIELDS.find(f => f.label === fieldLabel) ||
                               TARGET_FIELDS.find(f => f.label === fieldLabel);
              if (fieldDef) {
                colMap.set(colIdx, {
                  exCode: currentExCode,
                  field: fieldDef.field,
                  isPercent: 'isPercent' in fieldDef ? (fieldDef as typeof TEMPLATE_FIELDS[0]).isPercent : false,
                });
              }
            }
          });

          for (let ri = 2; ri < rows.length; ri++) {
            const row = rows[ri] as (string | number | null)[];
            const weekNum = Number(row[0]);
            if (!weekNum || isNaN(weekNum)) continue;

            const weekData: TemplateWeekData = {
              weekNumber: weekNum,
              weekType: String(row[2] ?? 'Medium'),
              weekLabel: String(row[3] ?? ''),
              totalReps: row[4] != null && row[4] !== '' ? Number(row[4]) : null,
              exerciseData: {},
            };

            colMap.forEach(({ exCode, field }, colIdx) => {
              const rawVal = row[colIdx];
              const numVal = rawVal != null && rawVal !== '' ? Number(rawVal) : null;
              if (!weekData.exerciseData[exCode]) weekData.exerciseData[exCode] = {} as Record<keyof MacroTarget, number | null>;
              weekData.exerciseData[exCode][field] = numVal;
            });

            parsedWeeks.push(weekData);
          }
        });

        const template: TemplateData = {
          name: templateName,
          unit: templateUnit,
          exercises: templateExerciseCodes.length > 0
            ? templateExerciseCodes
            : Object.keys(parsedWeeks[0]?.exerciseData ?? {}),
          weeks: parsedWeeks,
        };

        setTemplateData(template);

        // Auto-map exercise codes to library
        const mapping = new Map<string, string>();
        template.exercises.forEach(code => {
          const match = (exercises || []).find(ex =>
            (ex.exercise_code?.toLowerCase() === code.toLowerCase()) ||
            (ex.name.toLowerCase() === code.toLowerCase())
          );
          if (match) mapping.set(code, match.id);
        });
        setExerciseMapping(mapping);

        // Load planning PRs if we have an athlete
        if (athleteId) {
          const mappedExerciseIds = [...mapping.values()];
          if (mappedExerciseIds.length > 0) {
            const { data: prs } = await supabase
              .from('athlete_prs')
              .select('exercise_id, pr_value_kg')
              .eq('athlete_id', athleteId)
              .in('exercise_id', mappedExerciseIds);

            const prMap = new Map<string, number>();
            const currentMap = new Map<string, number>();
            (prs || []).forEach(pr => {
              if (pr.pr_value_kg) {
                prMap.set(pr.exercise_id, pr.pr_value_kg);
                currentMap.set(pr.exercise_id, pr.pr_value_kg);
              }
            });
            setPlanningPRs(prMap);
            setCurrentPRs(currentMap);

            // Load PR references
            const { data: exDetails } = await supabase
              .from('exercises')
              .select('id, pr_reference_exercise_id')
              .in('id', mappedExerciseIds);

            const refMap = new Map<string, string>();
            (exDetails || []).forEach(ex => {
              if (ex.pr_reference_exercise_id) {
                refMap.set(ex.id, ex.pr_reference_exercise_id);
              }
            });
            setPrReferences(refMap);
          }
        }

        setTemplateImportDone(false);
        setUpdatePRsAfterImport(false);
        setShowTemplateModal(true);
      } catch (err) {
        alert(`Failed to parse template: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsBinaryString(file);
  };

  const getMaxPercentages = (): Map<string, number> => {
    if (!templateData) return new Map();
    const maxPcts = new Map<string, number>();
    templateData.weeks.forEach(week => {
      Object.entries(week.exerciseData).forEach(([exCode, fields]) => {
        const exerciseId = exerciseMapping.get(exCode);
        if (!exerciseId) return;
        (['target_max', 'target_avg'] as (keyof MacroTarget)[]).forEach(field => {
          const val = fields[field];
          if (val != null && val > (maxPcts.get(exerciseId) ?? 0)) {
            maxPcts.set(exerciseId, val);
          }
        });
      });
    });
    return maxPcts;
  };

  const handleImportTemplate = async (mode: 'kg' | 'percentage') => {
    if (!templateData) return;

    // Validate: for kg mode, all mapped exercises with % data need PRs
    if (mode === 'kg') {
      const missingPRs: string[] = [];
      templateData.exercises.forEach(code => {
        const exerciseId = exerciseMapping.get(code);
        if (!exerciseId) return;
        // Check if this exercise has any percentage fields
        const hasPercentData = templateData.weeks.some(w => {
          const exData = w.exerciseData[code];
          if (!exData) return false;
          return (['target_max', 'target_avg'] as (keyof MacroTarget)[]).some(f => exData[f] != null && exData[f]! > 0);
        });
        if (hasPercentData) {
          const refId = prReferences.get(exerciseId) ?? exerciseId;
          if (!planningPRs.get(refId)) {
            missingPRs.push(code);
          }
        }
      });
      if (missingPRs.length > 0) {
        alert(`Cannot import as kg: missing planning PRs for: ${missingPRs.join(', ')}. Please enter PRs or use "Import as %" instead.`);
        return;
      }
    }

    setTemplateImporting(true);
    try {
      const rows: { weekId: string; trackedExId: string; field: keyof MacroTarget; value: number }[] = [];

      for (const week of templateData.weeks) {
        const macroWeek = macroWeeks.find(w => w.week_number === week.weekNumber);
        if (!macroWeek) continue;

        for (const exCode of templateData.exercises) {
          const exerciseId = exerciseMapping.get(exCode);
          if (!exerciseId) continue;

          const trackedEx = trackedExercises.find(te => te.exercise_id === exerciseId);
          if (!trackedEx) continue;

          const exData = week.exerciseData[exCode];
          if (!exData) continue;

          (['target_reps', 'target_avg', 'target_max', 'target_reps_at_max', 'target_sets_at_max'] as (keyof MacroTarget)[]).forEach(field => {
            let val = exData[field];
            if (val == null) return;

            if (mode === 'kg' && (field === 'target_max' || field === 'target_avg') && templateData.unit === 'percentage') {
              const resolved = resolvePercentage(val, exerciseId, planningPRs, prReferences);
              if (resolved === null) return;
              val = resolved;
            }

            rows.push({ weekId: macroWeek.id, trackedExId: trackedEx.id, field, value: val });
          });
        }
      }

      if (rows.length > 0) {
        await onImportTargets(rows);
      }

      // Optionally update athlete PRs
      if (updatePRsAfterImport && athleteId && planningPRs.size > 0) {
        for (const [exerciseId, prValue] of planningPRs.entries()) {
          const currentPR = currentPRs.get(exerciseId);
          if (currentPR !== prValue) {
            // Upsert PR
            const { data: existing } = await supabase
              .from('athlete_prs')
              .select('id')
              .eq('athlete_id', athleteId)
              .eq('exercise_id', exerciseId)
              .maybeSingle();

            if (existing) {
              await supabase
                .from('athlete_prs')
                .update({ pr_value_kg: prValue, pr_date: new Date().toISOString().split('T')[0] })
                .eq('id', existing.id);
            } else {
              await supabase
                .from('athlete_prs')
                .insert({ athlete_id: athleteId, exercise_id: exerciseId, pr_value_kg: prValue, pr_date: new Date().toISOString().split('T')[0], notes: null });
            }
          }
        }
      }

      setTemplateImportDone(true);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTemplateImporting(false);
    }
  };

  // Build exercise info for PlanningPRPanel
  const panelExercises = templateData?.exercises
    .map(code => {
      const exerciseId = exerciseMapping.get(code);
      if (!exerciseId) return null;
      const ex = allExercises.find(e => e.id === exerciseId);
      if (!ex) return null;
      return {
        id: ex.id,
        name: ex.name,
        exerciseCode: ex.exercise_code,
        currentPR: currentPRs.get(ex.id) ?? null,
        prReferenceId: prReferences.get(ex.id) ?? null,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null) ?? [];

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Export group */}
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          title="Export to Excel with actuals"
        >
          <Download size={12} />
          Export Excel
        </button>
        <button
          onClick={handleExportTemplate}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          title="Export as percentage-based template"
        >
          <Download size={12} />
          Export template (%)
        </button>

        {/* Visual separator */}
        <span className="text-gray-300 mx-1">|</span>

        {/* Import group */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          title="Import absolute kg targets from Excel"
        >
          <Upload size={12} />
          Import Excel
        </button>
        <button
          onClick={() => templateFileInputRef.current?.click()}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          title="Import a percentage-based template"
        >
          <Upload size={12} />
          Import template
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />
        <input
          ref={templateFileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleTemplateFileSelect}
          className="hidden"
        />
      </div>

      {/* ─── Regular Import Modal ─── */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-sm font-medium text-gray-900">Import Targets from Excel</h2>
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

      {/* ─── Template Import Modal ─── */}
      {showTemplateModal && templateData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-sm font-medium text-gray-900">
                  Import template: {templateData.name}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">{templateFilename} · {templateData.weeks.length} weeks · {templateData.unit}</p>
              </div>
              <button onClick={() => setShowTemplateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>

            {templateImportDone ? (
              <div className="flex-1 flex flex-col items-center justify-center py-8 gap-3">
                <div className="text-green-600 text-sm font-medium">Template imported successfully!</div>
                <button
                  onClick={() => setShowTemplateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  {/* Exercise mapping */}
                  <div>
                    <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Exercise mapping</h3>
                    <div className="space-y-2">
                      {templateData.exercises.map(code => (
                        <div key={code} className="flex items-center gap-2">
                          <span className="text-xs text-gray-600 w-20 flex-shrink-0">Template "{code}"</span>
                          <span className="text-xs text-gray-400">→</span>
                          <select
                            value={exerciseMapping.get(code) ?? ''}
                            onChange={async e => {
                              const newId = e.target.value;
                              const newMapping = new Map(exerciseMapping);
                              newMapping.set(code, newId);
                              setExerciseMapping(newMapping);

                              // Update planning PRs for new exercise
                              if (athleteId && newId) {
                                const { data: pr } = await supabase
                                  .from('athlete_prs')
                                  .select('pr_value_kg')
                                  .eq('athlete_id', athleteId)
                                  .eq('exercise_id', newId)
                                  .maybeSingle();

                                if (pr?.pr_value_kg) {
                                  setPlanningPRs(prev => new Map(prev).set(newId, pr.pr_value_kg!));
                                  setCurrentPRs(prev => new Map(prev).set(newId, pr.pr_value_kg!));
                                }

                                // Load PR reference
                                const { data: exData } = await supabase
                                  .from('exercises')
                                  .select('pr_reference_exercise_id')
                                  .eq('id', newId)
                                  .maybeSingle();
                                if (exData?.pr_reference_exercise_id) {
                                  setPrReferences(prev => new Map(prev).set(newId, exData.pr_reference_exercise_id!));
                                }
                              }
                            }}
                            className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">— Not mapped (skip) —</option>
                            {allExercises.map(ex => (
                              <option key={ex.id} value={ex.id}>
                                {ex.exercise_code ? `${ex.exercise_code} — ` : ''}{ex.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Planning PRs */}
                  {templateData.unit === 'percentage' && panelExercises.length > 0 && (
                    <PlanningPRPanel
                      exercises={panelExercises}
                      planningPRs={planningPRs}
                      onUpdatePR={(exerciseId, value) => {
                        setPlanningPRs(prev => new Map(prev).set(exerciseId, value));
                      }}
                      maxPercentages={getMaxPercentages()}
                    />
                  )}

                  {/* Preview */}
                  {templateData.unit === 'percentage' && panelExercises.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Preview (first 4 weeks)</h3>
                      <div className="space-y-1">
                        {templateData.weeks.slice(0, 4).map(week => {
                          const parts: string[] = [];
                          templateData.exercises.forEach(code => {
                            const exerciseId = exerciseMapping.get(code);
                            if (!exerciseId) return;
                            const exData = week.exerciseData[code];
                            if (!exData) return;
                            const maxPct = exData['target_max'];
                            if (maxPct != null) {
                              const resolvedMax = resolvePercentage(maxPct, exerciseId, planningPRs, prReferences);
                              parts.push(`${code} Max ${maxPct}%${resolvedMax !== null ? ` → ${resolvedMax} kg` : ''}`);
                            }
                          });
                          if (parts.length === 0) return null;
                          return (
                            <div key={week.weekNumber} className="text-xs text-gray-600">
                              <span className="font-medium">Wk {week.weekNumber}:</span> {parts.join(' · ')}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Update PRs checkbox */}
                  {athleteId && templateData.unit === 'percentage' && (
                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={updatePRsAfterImport}
                        onChange={e => setUpdatePRsAfterImport(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Also update athlete's PR table with these planning values
                    </label>
                  )}

                  {/* Group mode note */}
                  {!athleteId && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                      Group macro: "Import as %" is recommended. PRs will be resolved per-athlete later.
                    </div>
                  )}
                </div>

                <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0">
                  <button
                    onClick={() => setShowTemplateModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <div className="flex-1" />
                  {templateData.unit === 'percentage' && (
                    <button
                      onClick={() => handleImportTemplate('percentage')}
                      disabled={templateImporting}
                      className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      {templateImporting ? 'Importing…' : 'Import as %'}
                    </button>
                  )}
                  <button
                    onClick={() => handleImportTemplate('kg')}
                    disabled={templateImporting}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {templateImporting ? 'Importing…' : 'Import as kg'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
