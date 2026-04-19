/**
 * annualWheelRenderer.ts
 *
 * Pure geometry and canvas drawing functions for MacroAnnualWheel.
 * No React, no Supabase — only math and ctx calls.
 */
import type { MacroCycle, MacroPhase, MacroCompetition } from './database.types';

// ── Color palette ───────────────────────────────────────────────────

export const MACRO_COLORS = [
  '#378ADD', '#7F77DD', '#D85A30', '#D4537E', '#1D9E75',
  '#EF9F27', '#639922', '#E24B4A', '#888780',
];

export const CAL_EVENT_COLORS: Record<string, string> = {
  competition:   '#E24B4A',
  training_camp: '#2563eb',
  seminar:       '#7c3aed',
  testing_day:   '#d97706',
  team_meeting:  '#059669',
  other:         '#6b7280',
};

export const CAL_EVENT_LABELS: Record<string, string> = {
  competition:   'Competition',
  training_camp: 'Training Camp',
  seminar:       'Seminar',
  testing_day:   'Testing Day',
  team_meeting:  'Team Meeting',
  other:         'Event',
};

const PHASE_COLORS: Record<string, string> = {
  foundation: '#378ADD', grundlage: '#378ADD', grundlagenphase: '#378ADD', base: '#378ADD',
  build: '#EF9F27', aufbau: '#EF9F27', aufbauphase: '#EF9F27',
  peak: '#1D9E75', lap: '#1D9E75', leistungsausprägung: '#1D9E75',
  taper: '#5DCAA5', deload: '#5DCAA5',
  competition: '#E24B4A', wettkampf: '#E24B4A',
  transition: '#888780',
};

// ── Canvas constants ────────────────────────────────────────────────

export const SIZE = 600;
export const CX = SIZE / 2;
export const CY = SIZE / 2;
export const R_MONTH = 275;
export const R_MONTH_IN = 258;
export const R_MACRO = 250;
export const R_MACRO_IN = 212;
export const R_PHASE = 207;
export const R_PHASE_IN = 178;
export const R_COMP = 168;
export const R_CAL = 257;
export const R_CAL_IN = 251;
export const R_TODAY = 282;
export const PI2 = Math.PI * 2;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ── Hit zone types ──────────────────────────────────────────────────

export interface ArcHitZone {
  type: 'macro' | 'phase';
  a1: number; a2: number; rO: number; rI: number;
  macroId: string;
  macro?: MacroCycle;
  phase?: MacroPhase;
  clampedStart: boolean;
  clampedEnd: boolean;
  fullStart: string;
  fullEnd: string;
}

export interface CompHitZone {
  type: 'comp';
  cx: number; cy: number; r: number;
  comp: MacroCompetition;
  macroName: string;
}

export interface CalendarEvent {
  id: string;
  name: string;
  event_date: string;
  end_date: string | null;
  event_type: string;
  color: string | null;
}

export interface CalArcHitZone {
  type: 'cal_arc';
  a1: number; a2: number; rO: number; rI: number;
  event: CalendarEvent;
}

export interface CalMarkerHitZone {
  type: 'cal_marker';
  cx: number; cy: number; r: number;
  event: CalendarEvent;
}

export type HitZone = ArcHitZone | CompHitZone | CalArcHitZone | CalMarkerHitZone;

// ── Pure geometry helpers ───────────────────────────────────────────

export function daysInYear(y: number): number {
  return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
}

export function dayOfYear(dateStr: string): number {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
}

export function fracOfYear(dateStr: string, year: number): number {
  const d = new Date(dateStr);
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  if (d < jan1) return 0;
  if (d > dec31) return 1;
  return (dayOfYear(dateStr) - 0.5) / daysInYear(year);
}

export function overlapsYear(start: string, end: string, year: number): boolean {
  return new Date(start) <= new Date(year, 11, 31) && new Date(end) >= new Date(year, 0, 1);
}

export function dateInYear(dateStr: string, year: number): boolean {
  return new Date(dateStr).getFullYear() === year;
}

export function ang(frac: number): number {
  return frac * PI2 - Math.PI / 2;
}

export function polar(cx: number, cy: number, r: number, a: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function hex2rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function getPhaseColor(phase: MacroPhase): string {
  const name = (phase.name || phase.phase_type || '').toLowerCase();
  for (const [key, color] of Object.entries(PHASE_COLORS)) {
    if (name.includes(key)) return color;
  }
  return phase.color || '#888780';
}

export function getPhaseAbbr(phase: MacroPhase): string {
  const name = (phase.name || phase.phase_type || '').toLowerCase();
  if (name.includes('grundlagen') || name.includes('foundation') || name.includes('base')) return 'GP';
  if (name.includes('aufbau') || name.includes('build')) return 'AP';
  if (name.includes('lap') || name.includes('peak') || name.includes('leistung')) return 'LAP';
  if (name.includes('taper') || name.includes('deload')) return 'DL';
  if (name.includes('competition') || name.includes('wettkampf')) return 'WK';
  if (name.includes('transition')) return 'TR';
  return (phase.name || '').slice(0, 3);
}

// ── Draw params ─────────────────────────────────────────────────────

export interface DrawAnnualWheelParams {
  ctx: CanvasRenderingContext2D;
  year: number;
  macrocycles: MacroCycle[];
  allPhases: Record<string, MacroPhase[]>;
  allComps: Record<string, MacroCompetition[]>;
  calendarEvents: CalendarEvent[];
  macroColorMap: Map<string, string>;
  athleteName?: string;
  groupName?: string;
}

// ── Main draw function ──────────────────────────────────────────────

/**
 * Renders the annual wheel onto the given canvas context.
 * Returns the hit zones for interactive picking.
 */
export function drawAnnualWheel(params: DrawAnnualWheelParams): HitZone[] {
  const { ctx, year, macrocycles, allPhases, allComps, calendarEvents, macroColorMap, athleteName, groupName } = params;

  const dk = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const cBorder = dk ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';
  const cBorderL = dk ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const cText = dk ? '#c2c0b6' : '#3d3d3a';
  const cTextS = dk ? '#9c9a92' : '#73726c';
  const cTextT = dk ? '#73726c' : '#9c9a92';
  const cBg2 = dk ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const totalDays = daysInYear(year);
  const hitZones: HitZone[] = [];

  ctx.clearRect(0, 0, SIZE, SIZE);

  // Rings
  [R_MONTH, R_MONTH_IN, R_CAL, R_CAL_IN, R_PHASE_IN].forEach(r => {
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, PI2);
    ctx.strokeStyle = (r === R_PHASE_IN || r === R_CAL || r === R_CAL_IN) ? cBorderL : cBorder;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  });

  // Month segments
  let cumDays = 0;
  MONTHS.forEach((m, i) => {
    const md = (i === 1 && totalDays === 366) ? 29 : MONTH_DAYS[i];
    const f1 = cumDays / totalDays;
    const f2 = (cumDays + md) / totalDays;
    const a1 = ang(f1);
    const a2 = ang(f2);
    const am = ang((f1 + f2) / 2);

    ctx.beginPath();
    ctx.arc(CX, CY, R_MONTH, a1, a2);
    ctx.arc(CX, CY, R_MONTH_IN, a2, a1, true);
    ctx.closePath();
    ctx.fillStyle = cBg2;
    ctx.fill();

    const t1 = polar(CX, CY, R_MONTH, a1);
    const t2 = polar(CX, CY, R_MONTH + 5, a1);
    ctx.beginPath();
    ctx.moveTo(t1.x, t1.y);
    ctx.lineTo(t2.x, t2.y);
    ctx.strokeStyle = cBorder;
    ctx.lineWidth = 0.5;
    ctx.stroke();

    const lp = polar(CX, CY, R_MONTH + 16, am);
    ctx.save();
    ctx.translate(lp.x, lp.y);
    const rot = am > Math.PI / 2 && am < Math.PI * 1.5 ? am + Math.PI : am;
    ctx.rotate(rot);
    ctx.fillStyle = cTextS;
    ctx.font = '400 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m, 0, 0);
    ctx.restore();
    cumDays += md;
  });

  // ── Inner drawing helpers ───────────────────────────────────────

  function drawArc(rO: number, rI: number, a1: number, a2: number, fill: string, stroke: string | null, sw = 0.5) {
    ctx.beginPath();
    ctx.arc(CX, CY, rO, a1, a2);
    ctx.arc(CX, CY, rI, a2, a1, true);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = sw;
      ctx.stroke();
    }
  }

  function drawChevron(rO: number, rI: number, angle: number, dir: 'in' | 'out', color: string) {
    const rM = (rO + rI) / 2;
    const off = dir === 'in' ? 0.03 : -0.03;
    const p1 = polar(CX, CY, rO - 2, angle);
    const pm = polar(CX, CY, rM, angle + off);
    const p2 = polar(CX, CY, rI + 2, angle);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(pm.x, pm.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // ── Macro arcs ──────────────────────────────────────────────────

  let macroCount = 0;
  let compCount = 0;

  macrocycles.forEach((macro) => {
    if (!overlapsYear(macro.start_date, macro.end_date, year)) return;
    macroCount++;
    const color = macroColorMap.get(macro.id) || '#888';
    const f1 = Math.max(0, fracOfYear(macro.start_date, year));
    const f2 = Math.min(1, fracOfYear(macro.end_date, year));
    const a1 = ang(f1);
    const a2 = ang(f2);
    const clampedStart = new Date(macro.start_date) < new Date(year, 0, 1);
    const clampedEnd = new Date(macro.end_date) > new Date(year, 11, 31);

    drawArc(R_MACRO, R_MACRO_IN, a1, a2, hex2rgba(color, 0.15), color, 1);
    if (clampedStart) drawChevron(R_MACRO, R_MACRO_IN, a1, 'in', color);
    if (clampedEnd) drawChevron(R_MACRO, R_MACRO_IN, a2, 'out', color);

    const span = a2 - a1;
    if (span > 0.25) {
      const am = (a1 + a2) / 2;
      const lp = polar(CX, CY, (R_MACRO + R_MACRO_IN) / 2, am);
      ctx.save();
      ctx.translate(lp.x, lp.y);
      const rot = am > Math.PI / 2 && am < Math.PI * 1.5 ? am + Math.PI : am;
      ctx.rotate(rot);
      ctx.fillStyle = color;
      ctx.font = '500 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(macro.name, 0, 0);
      ctx.restore();
    }

    hitZones.push({
      type: 'macro', a1, a2, rO: R_MACRO, rI: R_MACRO_IN,
      macroId: macro.id, macro,
      clampedStart, clampedEnd,
      fullStart: macro.start_date, fullEnd: macro.end_date,
    });

    // Phases
    const phases = allPhases[macro.id] || [];
    phases.forEach(phase => {
      const macroStartDate = new Date(macro.start_date);
      const pStart = new Date(macroStartDate.getTime() + (phase.start_week_number - 1) * 7 * 86400000);
      const pEnd = new Date(macroStartDate.getTime() + phase.end_week_number * 7 * 86400000 - 86400000);
      const pStartStr = pStart.toISOString().split('T')[0];
      const pEndStr = pEnd.toISOString().split('T')[0];

      if (!overlapsYear(pStartStr, pEndStr, year)) return;

      const pf1 = Math.max(0, fracOfYear(pStartStr, year));
      const pf2 = Math.min(1, fracOfYear(pEndStr, year));
      const pa1 = ang(pf1);
      const pa2 = ang(pf2);
      const pColor = phase.color || getPhaseColor(phase);
      const pClS = pStart < new Date(year, 0, 1);
      const pClE = pEnd > new Date(year, 11, 31);

      drawArc(R_PHASE, R_PHASE_IN, pa1, pa2, hex2rgba(pColor, 0.35), pColor, 0.5);
      if (pClS) drawChevron(R_PHASE, R_PHASE_IN, pa1, 'in', pColor);
      if (pClE) drawChevron(R_PHASE, R_PHASE_IN, pa2, 'out', pColor);

      if (pa2 - pa1 > 0.15) {
        const abbr = getPhaseAbbr(phase);
        const pp = polar(CX, CY, (R_PHASE + R_PHASE_IN) / 2, (pa1 + pa2) / 2);
        ctx.save();
        ctx.translate(pp.x, pp.y);
        const pr = (pa1 + pa2) / 2;
        const prot = pr > Math.PI / 2 && pr < Math.PI * 1.5 ? pr + Math.PI : pr;
        ctx.rotate(prot);
        ctx.fillStyle = pColor;
        ctx.font = '500 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(abbr, 0, 0);
        ctx.restore();
      }

      hitZones.push({
        type: 'phase', a1: pa1, a2: pa2, rO: R_PHASE, rI: R_PHASE_IN,
        macroId: macro.id, macro, phase,
        clampedStart: pClS, clampedEnd: pClE,
        fullStart: pStartStr, fullEnd: pEndStr,
      });
    });

    // Competitions
    const comps = allComps[macro.id] || [];
    comps.forEach(comp => {
      if (!dateInYear(comp.competition_date, year)) return;
      compCount++;
      const cf = fracOfYear(comp.competition_date, year);
      const ca = ang(cf);
      const dp = polar(CX, CY, R_COMP, ca);
      const r = 8;
      const col = comp.is_primary ? '#E24B4A' : '#EF9F27';

      ctx.beginPath();
      ctx.moveTo(dp.x, dp.y - r);
      ctx.lineTo(dp.x + r * 0.6, dp.y);
      ctx.lineTo(dp.x, dp.y + r);
      ctx.lineTo(dp.x - r * 0.6, dp.y);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();

      hitZones.push({ type: 'comp', cx: dp.x, cy: dp.y, r: 12, comp, macroName: macro.name });
    });
  });

  // ── Calendar events ─────────────────────────────────────────────

  const usedEventIds = new Set(
    Object.values(allComps).flat().map(c => c.event_id).filter(Boolean),
  );

  calendarEvents.forEach(ev => {
    if (!overlapsYear(ev.event_date, ev.end_date || ev.event_date, year)) return;

    const isMultiDay = !!(ev.end_date && ev.end_date > ev.event_date);
    const color = ev.color || CAL_EVENT_COLORS[ev.event_type] || '#6b7280';

    if (isMultiDay) {
      const cf1 = Math.max(0, fracOfYear(ev.event_date, year));
      const cf2 = Math.min(1, fracOfYear(ev.end_date!, year));
      const ca1 = ang(cf1);
      const ca2 = ang(cf2);
      drawArc(R_CAL, R_CAL_IN, ca1, ca2, hex2rgba(color, 0.5), color, 0.5);

      if (ca2 - ca1 > 0.12) {
        const am = (ca1 + ca2) / 2;
        const lp = polar(CX, CY, (R_CAL + R_CAL_IN) / 2, am);
        ctx.save();
        ctx.translate(lp.x, lp.y);
        const rot = am > Math.PI / 2 && am < Math.PI * 1.5 ? am + Math.PI : am;
        ctx.rotate(rot);
        ctx.fillStyle = color;
        ctx.font = '500 7px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ev.name, 0, 0);
        ctx.restore();
      }
      hitZones.push({ type: 'cal_arc', a1: ca1, a2: ca2, rO: R_CAL, rI: R_CAL_IN, event: ev });
    } else {
      if (!dateInYear(ev.event_date, year)) return;
      const cf = fracOfYear(ev.event_date, year);
      const ca = ang(cf);

      if (ev.event_type === 'competition' && !usedEventIds.has(ev.id)) {
        const dp = polar(CX, CY, R_COMP, ca);
        const r = 7;
        ctx.beginPath();
        ctx.moveTo(dp.x, dp.y - r);
        ctx.lineTo(dp.x + r * 0.6, dp.y);
        ctx.lineTo(dp.x, dp.y + r);
        ctx.lineTo(dp.x - r * 0.6, dp.y);
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        compCount++;
        hitZones.push({ type: 'cal_marker', cx: dp.x, cy: dp.y, r: 12, event: ev });
      } else if (ev.event_type !== 'competition') {
        const dp = polar(CX, CY, (R_CAL + R_CAL_IN) / 2, ca);
        const r = 3.5;
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, r, 0, PI2);
        ctx.fillStyle = hex2rgba(color, 0.9);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        hitZones.push({ type: 'cal_marker', cx: dp.x, cy: dp.y, r: 10, event: ev });
      }
    }
  });

  // ── Today needle ────────────────────────────────────────────────

  const now = new Date();
  if (now.getFullYear() === year) {
    const tf = fracOfYear(now.toISOString().split('T')[0], year);
    const ta = ang(tf);
    const t1 = polar(CX, CY, R_PHASE_IN - 10, ta);
    const t2 = polar(CX, CY, R_TODAY, ta);
    ctx.beginPath();
    ctx.moveTo(t1.x, t1.y);
    ctx.lineTo(t2.x, t2.y);
    ctx.strokeStyle = dk ? '#F09595' : '#E24B4A';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    const dot = polar(CX, CY, R_TODAY + 4, ta);
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 3, 0, PI2);
    ctx.fillStyle = dk ? '#F09595' : '#E24B4A';
    ctx.fill();
  }

  // ── Center text ─────────────────────────────────────────────────

  ctx.fillStyle = cText;
  ctx.font = '500 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(year), CX, CY - 14);

  const label = athleteName || groupName || '';
  if (label) {
    ctx.fillStyle = cTextS;
    ctx.font = '400 11px sans-serif';
    ctx.fillText(label, CX, CY + 6);
  }

  ctx.fillStyle = cTextS;
  ctx.font = '400 10px sans-serif';
  ctx.fillText(
    `${macroCount} macrocycle${macroCount !== 1 ? 's' : ''}`,
    CX, CY + (label ? 22 : 6),
  );
  ctx.fillStyle = cTextT;
  ctx.fillText(
    `${compCount} competition${compCount !== 1 ? 's' : ''}`,
    CX, CY + (label ? 36 : 20),
  );

  return hitZones;
}
