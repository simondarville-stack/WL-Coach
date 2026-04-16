/**
 * Generates smolov_base_template.xlsx — a Smolov-style percentage template
 * for use with the WL-Coach "Import template" feature.
 *
 * Run: node scripts/generate-smolov-template.mjs
 */

import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'smolov_base_template.xlsx');

// ─── Template structure ───────────────────────────────────────────────────────
// Exercises: Sn (Snatch), CJ (Clean & Jerk), BSq (Back Squat), FSq (Front Squat)
// 4 weeks: 3 loading + 1 deload
//
// Column layout per phase sheet:
//   0:Wk  1:Date  2:Type  3:Label  4:Total Reps
//   then per exercise: Target Reps | Target Avg% | Target Hi% | Target RMax | Target SMax

const EXERCISES = ['Sn', 'CJ', 'BSq', 'FSq'];
const FIELDS = ['Target Reps', 'Target Avg%', 'Target Hi%', 'Target RMax', 'Target SMax'];
// Corresponds to: target_reps, target_avg, target_max, target_reps_at_max, target_sets_at_max

function buildHeaderRows() {
  const row1 = ['Wk', 'Date', 'Type', 'Label', 'Total Reps'];
  const row2 = ['', '', '', '', ''];
  for (const ex of EXERCISES) {
    FIELDS.forEach((field, fi) => {
      row1.push(fi === 0 ? ex : '');
      row2.push(field);
    });
  }
  return [row1, row2];
}

// week data: { weekNum, date, type, label, totalReps, exercises: { Sn/CJ/BSq/FSq: [reps, avg%, hi%, rmax, smax] } }
const PHASE1_WEEKS = [
  {
    weekNum: 1, date: '', type: 'volume', label: 'Base load',
    totalReps: 136,
    exercises: {
      Sn:  [20, 75, 82, 2, 4],   // 4×5@82%, avg ~75%
      CJ:  [15, 75, 82, 2, 3],
      BSq: [36, 78, 85, 5, 4],   // classic Smolov: 4×9@70, 5×7@75, 7×5@80, 10×3@85
      FSq: [20, 72, 80, 3, 4],
    },
  },
  {
    weekNum: 2, date: '', type: 'volume', label: 'Accumulation',
    totalReps: 148,
    exercises: {
      Sn:  [24, 77, 85, 2, 4],
      CJ:  [18, 77, 85, 2, 3],
      BSq: [40, 80, 87, 5, 5],
      FSq: [24, 75, 82, 3, 4],
    },
  },
  {
    weekNum: 3, date: '', type: 'intensity', label: 'Peak load',
    totalReps: 130,
    exercises: {
      Sn:  [20, 80, 90, 2, 3],
      CJ:  [15, 80, 90, 2, 3],
      BSq: [30, 83, 90, 3, 5],   // peaking: 7×5@80, 5×4@85, 3×3@90
      FSq: [18, 78, 85, 3, 3],
    },
  },
];

const PHASE2_WEEKS = [
  {
    weekNum: 4, date: '', type: 'deload', label: 'Recovery',
    totalReps: 48,
    exercises: {
      Sn:  [10, 63, 70, 2, 2],
      CJ:  [ 8, 63, 70, 2, 2],
      BSq: [15, 60, 70, 3, 3],
      FSq: [10, 60, 68, 3, 2],
    },
  },
];

function buildDataRows(weeks) {
  return weeks.map(w => {
    const row = [w.weekNum, w.date, w.type, w.label, w.totalReps];
    for (const ex of EXERCISES) {
      const vals = w.exercises[ex] ?? [null, null, null, null, null];
      row.push(...vals);
    }
    return row;
  });
}

// ─── Build workbook ───────────────────────────────────────────────────────────

const wb = XLSX.utils.book_new();

// Sheet 1: Template Info
const infoRows = [
  ['Template name:', 'Smolov Base Mesocycle'],
  ['Duration:', '4 weeks'],
  ['Unit:', 'percentage'],
  ['Exercises:', EXERCISES.join(', ')],
  ['Generated:', new Date().toISOString().split('T')[0]],
  [],
  ['Notes:', 'Weeks 1-3: loading block (volume → intensity). Week 4: deload.'],
  ['Notes:', 'Sn = Snatch, CJ = Clean & Jerk, BSq = Back Squat, FSq = Front Squat'],
  ['Notes:', 'Hi% = max single/top set, Avg% = average load across all sets'],
  ['Notes:', 'RMax = reps at max weight, SMax = sets at max weight'],
];
const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
wsInfo['!cols'] = [{ wch: 18 }, { wch: 52 }];
XLSX.utils.book_append_sheet(wb, wsInfo, 'Template Info');

// Sheet 2: Phase 1 - Loading
const [h1, h2] = buildHeaderRows();
const phase1Rows = [h1, h2, ...buildDataRows(PHASE1_WEEKS)];
const wsPhase1 = XLSX.utils.aoa_to_sheet(phase1Rows);
wsPhase1['!cols'] = [
  { wch: 4 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 10 },
  ...EXERCISES.flatMap(() => FIELDS.map(() => ({ wch: 12 }))),
];
XLSX.utils.book_append_sheet(wb, wsPhase1, 'Phase 1 - Loading');

// Sheet 3: Phase 2 - Deload
const [h1d, h2d] = buildHeaderRows();
const phase2Rows = [h1d, h2d, ...buildDataRows(PHASE2_WEEKS)];
const wsPhase2 = XLSX.utils.aoa_to_sheet(phase2Rows);
wsPhase2['!cols'] = wsPhase1['!cols'];
XLSX.utils.book_append_sheet(wb, wsPhase2, 'Phase 2 - Deload');

// ─── Write file ───────────────────────────────────────────────────────────────
XLSX.writeFile(wb, outPath);
console.log(`Written: ${outPath}`);
console.log(`Sheets: ${wb.SheetNames.join(', ')}`);
console.log(`Exercises: ${EXERCISES.join(', ')}`);
console.log(`Weeks: 4 (3 loading + 1 deload)`);
