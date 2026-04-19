import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { MacroCycle, MacroPhase, MacroCompetition } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';

interface MacroAnnualWheelProps {
  macrocycles: MacroCycle[];
  onSelectCycle: (cycle: MacroCycle) => void;
  onCreateCycle: () => void;
  athleteName?: string;
  groupName?: string;
  athleteId?: string;
  groupId?: string;
}

// ── Color palette for macro arcs ───────────────────────────────────
const MACRO_COLORS = [
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

const CAL_EVENT_LABELS: Record<string, string> = {
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

function getPhaseColor(phase: MacroPhase): string {
  const name = (phase.name || phase.phase_type || '').toLowerCase();
  for (const [key, color] of Object.entries(PHASE_COLORS)) {
    if (name.includes(key)) return color;
  }
  return phase.color || '#888780';
}

function getPhaseAbbr(phase: MacroPhase): string {
  const name = (phase.name || phase.phase_type || '').toLowerCase();
  if (name.includes('grundlagen') || name.includes('foundation') || name.includes('base')) return 'GP';
  if (name.includes('aufbau') || name.includes('build')) return 'AP';
  if (name.includes('lap') || name.includes('peak') || name.includes('leistung')) return 'LAP';
  if (name.includes('taper') || name.includes('deload')) return 'DL';
  if (name.includes('competition') || name.includes('wettkampf')) return 'WK';
  if (name.includes('transition')) return 'TR';
  return (phase.name || '').slice(0, 3);
}

function hex2rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Date math ──────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInYear(y: number): number {
  return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
}

function dayOfYear(dateStr: string): number {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
}

function fracOfYear(dateStr: string, year: number): number {
  const d = new Date(dateStr);
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  if (d < jan1) return 0;
  if (d > dec31) return 1;
  return (dayOfYear(dateStr) - 0.5) / daysInYear(year);
}

function overlapsYear(start: string, end: string, year: number): boolean {
  return new Date(start) <= new Date(year, 11, 31) && new Date(end) >= new Date(year, 0, 1);
}

function dateInYear(dateStr: string, year: number): boolean {
  const d = new Date(dateStr);
  return d.getFullYear() === year;
}

// ── Canvas constants ───────────────────────────────────────────────
const SIZE = 600;
const CX = SIZE / 2, CY = SIZE / 2;
const R_MONTH = 275, R_MONTH_IN = 258;
const R_MACRO = 250, R_MACRO_IN = 212;
const R_PHASE = 207, R_PHASE_IN = 178;
const R_COMP = 168;
const R_CAL = 257, R_CAL_IN = 251;
const R_TODAY = 282;
const PI2 = Math.PI * 2;

function ang(frac: number): number {
  return frac * PI2 - Math.PI / 2;
}

function polar(cx: number, cy: number, r: number, a: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

// ── Hit zone types ─────────────────────────────────────────────────
interface ArcHitZone {
  type: 'macro' | 'phase';
  a1: number;
  a2: number;
  rO: number;
  rI: number;
  macroId: string;
  macro?: MacroCycle;
  phase?: MacroPhase;
  clampedStart: boolean;
  clampedEnd: boolean;
  fullStart: string;
  fullEnd: string;
}

interface CompHitZone {
  type: 'comp';
  cx: number;
  cy: number;
  r: number;
  comp: MacroCompetition;
  macroName: string;
}

// ── Calendar event types ───────────────────────────────────────────
interface CalendarEvent {
  id: string;
  name: string;
  event_date: string;
  end_date: string | null;
  event_type: string;
  color: string | null;
}

interface CalArcHitZone {
  type: 'cal_arc';
  a1: number; a2: number; rO: number; rI: number;
  event: CalendarEvent;
}
interface CalMarkerHitZone {
  type: 'cal_marker';
  cx: number; cy: number; r: number;
  event: CalendarEvent;
}

type HitZone = ArcHitZone | CompHitZone | CalArcHitZone | CalMarkerHitZone;

// ── Component ──────────────────────────────────────────────────────
export function MacroAnnualWheel({
  macrocycles,
  onSelectCycle,
  onCreateCycle,
  athleteName,
  groupName,
  athleteId,
  groupId,
}: MacroAnnualWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [allPhases, setAllPhases] = useState<Record<string, MacroPhase[]>>({});
  const [allComps, setAllComps] = useState<Record<string, MacroCompetition[]>>({});
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; html: string } | null>(null);
  const hitZonesRef = useRef<HitZone[]>([]);
  const rafRef = useRef<number>(0);

  // Assign stable colors to macros
  const macroColorMap = useRef(new Map<string, string>());
  macrocycles.forEach((mc, i) => {
    if (!macroColorMap.current.has(mc.id)) {
      macroColorMap.current.set(mc.id, MACRO_COLORS[i % MACRO_COLORS.length]);
    }
  });

  // Load all phases and competitions for all macrocycles
  useEffect(() => {
    if (macrocycles.length === 0) return;
    const ids = macrocycles.map(mc => mc.id);
    let cancelled = false;

    (async () => {
      const [phasesRes, compsRes] = await Promise.all([
        supabase.from('macro_phases').select('*').in('macrocycle_id', ids).eq('owner_id', getOwnerId()).order('position'),
        supabase.from('macro_competitions').select('*').in('macrocycle_id', ids).eq('owner_id', getOwnerId()).order('competition_date'),
      ]);
      if (cancelled) return;

      const pMap: Record<string, MacroPhase[]> = {};
      (phasesRes.data || []).forEach(p => {
        if (!pMap[p.macrocycle_id]) pMap[p.macrocycle_id] = [];
        pMap[p.macrocycle_id].push(p);
      });
      setAllPhases(pMap);

      const cMap: Record<string, MacroCompetition[]> = {};
      (compsRes.data || []).forEach(c => {
        if (!cMap[c.macrocycle_id]) cMap[c.macrocycle_id] = [];
        cMap[c.macrocycle_id].push(c);
      });
      setAllComps(cMap);
    })();
    return () => { cancelled = true; };
  }, [macrocycles]);

  // Load calendar events for the athlete / group
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let athleteIds: string[] = [];
      if (athleteId) {
        athleteIds = [athleteId];
      } else if (groupId) {
        const { data: members } = await supabase
          .from('group_members')
          .select('athlete_id')
          .eq('group_id', groupId)
          .is('left_at', null);
        athleteIds = (members || []).map((m: { athlete_id: string }) => m.athlete_id);
      }
      if (cancelled) return;
      if (athleteIds.length === 0) { setCalendarEvents([]); return; }

      const { data: ea } = await supabase
        .from('event_athletes')
        .select('event_id')
        .in('athlete_id', athleteIds);
      const eventIds = [...new Set((ea || []).map((e: { event_id: string }) => e.event_id))];
      if (cancelled) return;
      if (eventIds.length === 0) { setCalendarEvents([]); return; }

      const { data: evs } = await supabase
        .from('events')
        .select('id, name, event_date, end_date, event_type, color')
        .eq('owner_id', getOwnerId())
        .in('id', eventIds)
        .order('event_date');
      if (!cancelled) setCalendarEvents((evs as CalendarEvent[]) || []);
    };
    load();
    return () => { cancelled = true; };
  }, [athleteId, groupId]);

  // ── Render ─────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
      const f1 = cumDays / totalDays, f2 = (cumDays + md) / totalDays;
      const a1 = ang(f1), a2 = ang(f2), am = ang((f1 + f2) / 2);

      // Segment fill
      ctx.beginPath();
      ctx.arc(CX, CY, R_MONTH, a1, a2);
      ctx.arc(CX, CY, R_MONTH_IN, a2, a1, true);
      ctx.closePath();
      ctx.fillStyle = cBg2;
      ctx.fill();

      // Tick
      const t1 = polar(CX, CY, R_MONTH, a1);
      const t2 = polar(CX, CY, R_MONTH + 5, a1);
      ctx.beginPath();
      ctx.moveTo(t1.x, t1.y);
      ctx.lineTo(t2.x, t2.y);
      ctx.strokeStyle = cBorder;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Label
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

    // ── Draw arcs helper ─────────────────────────────────────────
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

    // ── Macro arcs ───────────────────────────────────────────────
    let macroCount = 0;
    let compCount = 0;

    macrocycles.forEach((macro) => {
      if (!overlapsYear(macro.start_date, macro.end_date, year)) return;
      macroCount++;
      const color = macroColorMap.current.get(macro.id) || '#888';
      const f1 = Math.max(0, fracOfYear(macro.start_date, year));
      const f2 = Math.min(1, fracOfYear(macro.end_date, year));
      const a1 = ang(f1), a2 = ang(f2);
      const clampedStart = new Date(macro.start_date) < new Date(year, 0, 1);
      const clampedEnd = new Date(macro.end_date) > new Date(year, 11, 31);

      drawArc(R_MACRO, R_MACRO_IN, a1, a2, hex2rgba(color, 0.15), color, 1);

      if (clampedStart) drawChevron(R_MACRO, R_MACRO_IN, a1, 'in', color);
      if (clampedEnd) drawChevron(R_MACRO, R_MACRO_IN, a2, 'out', color);

      // Label
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
        if (!overlapsYear(phase.start_week_number.toString(), phase.end_week_number.toString(), year)) {
          // Phase dates are week numbers — derive from macro dates
        }
        // Use phase start/end dates if available, else approximate from week numbers
        const phaseStart = (phase as any).start_date || macro.start_date;
        const phaseEnd = (phase as any).end_date || macro.end_date;

        // Approximate phase date range from macro start + week numbers
        const macroStartDate = new Date(macro.start_date);
        const pStart = new Date(macroStartDate.getTime() + (phase.start_week_number - 1) * 7 * 86400000);
        const pEnd = new Date(macroStartDate.getTime() + phase.end_week_number * 7 * 86400000 - 86400000);
        const pStartStr = pStart.toISOString().split('T')[0];
        const pEndStr = pEnd.toISOString().split('T')[0];

        if (!overlapsYear(pStartStr, pEndStr, year)) return;

        const pf1 = Math.max(0, fracOfYear(pStartStr, year));
        const pf2 = Math.min(1, fracOfYear(pEndStr, year));
        const pa1 = ang(pf1), pa2 = ang(pf2);
        const pColor = phase.color || getPhaseColor(phase);
        const pClS = pStart < new Date(year, 0, 1);
        const pClE = pEnd > new Date(year, 11, 31);

        drawArc(R_PHASE, R_PHASE_IN, pa1, pa2, hex2rgba(pColor, 0.35), pColor, 0.5);

        if (pClS) drawChevron(R_PHASE, R_PHASE_IN, pa1, 'in', pColor);
        if (pClE) drawChevron(R_PHASE, R_PHASE_IN, pa2, 'out', pColor);

        // Phase abbreviation
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

        // Diamond
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

        hitZones.push({
          type: 'comp', cx: dp.x, cy: dp.y, r: 12,
          comp, macroName: macro.name,
        });
      });
    });

    // ── Calendar events ──────────────────────────────────────────
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
        const ca1 = ang(cf1), ca2 = ang(cf2);
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
        // Single-day
        if (!dateInYear(ev.event_date, year)) return;
        const cf = fracOfYear(ev.event_date, year);
        const ca = ang(cf);

        if (ev.event_type === 'competition' && !usedEventIds.has(ev.id)) {
          // Calendar competition not linked to a macro: hollow diamond at R_COMP
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
          // Other single-day event: small dot at cal ring midpoint
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

    // ── Today needle ─────────────────────────────────────────────
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

    // ── Center text ──────────────────────────────────────────────
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

    hitZonesRef.current = hitZones;
  }, [year, macrocycles, allPhases, allComps, calendarEvents, athleteName, groupName]);

  useEffect(() => { render(); }, [render]);

  // Re-render on color scheme change
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => render();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [render]);

  // ── Hit testing ────────────────────────────────────────────────
  const hitTest = useCallback((mx: number, my: number): HitZone | null => {
    const dx = mx - CX, dy = my - CY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let a = Math.atan2(dy, dx);
    if (a < -Math.PI / 2) a += PI2;

    for (const z of hitZonesRef.current) {
      if (z.type === 'comp' || z.type === 'cal_marker') {
        if (Math.abs(mx - z.cx) < z.r && Math.abs(my - z.cy) < z.r) return z;
      } else {
        if (dist >= z.rI && dist <= z.rO && a >= z.a1 && a <= z.a2) return z;
      }
    }
    return null;
  }, []);

  const getMousePos = useCallback((e: React.MouseEvent<HTMLCanvasElement>): { mx: number; my: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = SIZE / rect.width;
    return { mx: (e.clientX - rect.left) * sx, my: (e.clientY - rect.top) * sx };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Snapshot coords before the event is recycled (React synthetic event pooling)
    const clientX = e.clientX;
    const clientY = e.clientY;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      const rect = canvas.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const sx = SIZE / rect.width;
      const mx = (clientX - rect.left) * sx;
      const my = (clientY - rect.top) * sx;
      const hit = hitTest(mx, my);

      if (hit) {
        canvas.style.cursor = 'pointer';
        const x = clientX - wrapRect.left + 12;
        const y = clientY - wrapRect.top - 10;

        let html = '';
        if (hit.type === 'macro') {
          html = `<div style="font-weight:500;font-size:12px;margin-bottom:3px">${hit.macro!.name}</div>`;
          html += `<div style="font-size:10px;color:var(--color-text-secondary)">${hit.fullStart} → ${hit.fullEnd}</div>`;
          if (hit.clampedStart) html += `<div style="font-size:9px;color:var(--color-text-tertiary);margin-top:3px;font-style:italic">← continues from ${year - 1}</div>`;
          if (hit.clampedEnd) html += `<div style="font-size:9px;color:var(--color-text-tertiary);margin-top:3px;font-style:italic">continues into ${year + 1} →</div>`;
          html += `<div style="font-size:9px;color:var(--color-text-info);margin-top:4px">Click to open</div>`;
        } else if (hit.type === 'phase') {
          html = `<div style="font-weight:500;font-size:12px;margin-bottom:3px">${hit.phase!.name}</div>`;
          html += `<div style="font-size:10px;color:var(--color-text-secondary)">${hit.fullStart} → ${hit.fullEnd}</div>`;
          html += `<div style="display:flex;align-items:center;gap:4px;margin-top:3px;font-size:10px"><span style="width:6px;height:6px;border-radius:50%;background:${macroColorMap.current.get(hit.macroId) || '#888'}"></span>${hit.macro!.name}</div>`;
          html += `<div style="font-size:9px;color:var(--color-text-info);margin-top:4px">Click to open macro</div>`;
        } else if (hit.type === 'comp') {
          html = `<div style="font-weight:500;font-size:12px;margin-bottom:3px">${hit.comp.competition_name}</div>`;
          html += `<div style="font-size:10px;color:var(--color-text-secondary)">${hit.comp.competition_date}</div>`;
          html += `<div style="font-size:10px;margin-top:3px">${hit.comp.is_primary ? 'Primary competition' : 'Qualification / secondary'}</div>`;
          html += `<div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">${hit.macroName}</div>`;
        } else if (hit.type === 'cal_arc') {
          const typeLabel = CAL_EVENT_LABELS[hit.event.event_type] || 'Event';
          html = `<div style="font-weight:500;font-size:12px;margin-bottom:3px">${hit.event.name}</div>`;
          html += `<div style="font-size:10px;color:var(--color-text-secondary)">${hit.event.event_date} → ${hit.event.end_date}</div>`;
          html += `<div style="font-size:10px;color:var(--color-text-tertiary);margin-top:2px">${typeLabel}</div>`;
        } else if (hit.type === 'cal_marker') {
          const typeLabel = CAL_EVENT_LABELS[hit.event.event_type] || 'Event';
          html = `<div style="font-weight:500;font-size:12px;margin-bottom:3px">${hit.event.name}</div>`;
          html += `<div style="font-size:10px;color:var(--color-text-secondary)">${hit.event.event_date}</div>`;
          html += `<div style="font-size:10px;color:var(--color-text-tertiary);margin-top:2px">${typeLabel}</div>`;
        }

        setTooltip({ x: Math.min(x, (wrapRect.width || 600) - 180), y, html });
      } else {
        canvas.style.cursor = 'default';
        setTooltip(null);
      }
    });
  }, [hitTest, year]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { mx, my } = getMousePos(e);
    const hit = hitTest(mx, my);
    if (hit && (hit.type === 'macro' || hit.type === 'phase')) {
      const macro = macrocycles.find(mc => mc.id === hit.macroId);
      if (macro) onSelectCycle(macro);
    }
  }, [hitTest, getMousePos, macrocycles, onSelectCycle]);

  const handleMouseLeave = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setTooltip(null);
    if (canvasRef.current) canvasRef.current.style.cursor = 'default';
  }, []);

  // ── Dynamic legend data ──────────────────────────────────────────
  const legendPhases = useMemo(() => {
    const seen = new Map<string, { color: string; name: string }>();
    macrocycles.forEach(mc => {
      if (!overlapsYear(mc.start_date, mc.end_date, year)) return;
      (allPhases[mc.id] || []).forEach(phase => {
        const color = phase.color || getPhaseColor(phase);
        if (!seen.has(phase.name)) seen.set(phase.name, { color, name: phase.name });
      });
    });
    return Array.from(seen.values());
  }, [allPhases, macrocycles, year]);

  const hasComps = useMemo(() => {
    const macroHas = macrocycles.some(mc => {
      if (!overlapsYear(mc.start_date, mc.end_date, year)) return false;
      return (allComps[mc.id] || []).some(c => dateInYear(c.competition_date, year));
    });
    const calHas = calendarEvents.some(
      ev => ev.event_type === 'competition' && dateInYear(ev.event_date, year),
    );
    return macroHas || calHas;
  }, [allComps, macrocycles, calendarEvents, year]);

  const legendCalTypes = useMemo(() => {
    const seen = new Map<string, { color: string; label: string }>();
    calendarEvents.forEach(ev => {
      if (ev.event_type === 'competition') return;
      if (!overlapsYear(ev.event_date, ev.end_date || ev.event_date, year)) return;
      if (!seen.has(ev.event_type)) {
        seen.set(ev.event_type, {
          color: ev.color || CAL_EVENT_COLORS[ev.event_type] || '#6b7280',
          label: CAL_EVENT_LABELS[ev.event_type] || ev.event_type,
        });
      }
    });
    return Array.from(seen.values());
  }, [calendarEvents, year]);

  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4">
      {/* Year navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setYear(y => y - 1)}
          className="px-2.5 py-1 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
        >
          ‹
        </button>
        <span className="text-lg font-medium font-mono text-gray-900 min-w-[60px] text-center">
          {year}
        </span>
        <button
          onClick={() => setYear(y => y + 1)}
          className="px-2.5 py-1 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
        >
          ›
        </button>
        <button
          onClick={() => setYear(new Date().getFullYear())}
          className="px-2 py-1 text-xs border border-gray-200 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50"
        >
          Today
        </button>
      </div>

      {/* Wheel */}
      <div ref={wrapRef} className="relative w-full" style={{ maxWidth: 580 }}>
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          style={{ width: '100%', height: 'auto' }}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onMouseLeave={handleMouseLeave}
        />
        {tooltip && (
          <div
            className="absolute pointer-events-none bg-white border border-gray-200 rounded-lg px-3 py-2 text-[11px] text-gray-900 shadow-sm z-10"
            style={{ left: tooltip.x, top: tooltip.y, minWidth: 150 }}
            dangerouslySetInnerHTML={{ __html: tooltip.html }}
          />
        )}
      </div>

      {/* Legend — derived from actual data in the selected year */}
      {(legendPhases.length > 0 || hasComps || legendCalTypes.length > 0) && (
        <div className="flex flex-wrap gap-3 justify-center text-[10px] text-gray-500">
          {legendPhases.map(p => (
            <span key={p.name} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
          ))}
          {hasComps && (
            <>
              <span className="flex items-center gap-1">
                <span className="rounded-sm rotate-45" style={{ backgroundColor: '#E24B4A', width: 7, height: 7, display: 'inline-block' }} />
                Primary
              </span>
              <span className="flex items-center gap-1">
                <span className="rounded-sm rotate-45" style={{ backgroundColor: '#EF9F27', width: 7, height: 7, display: 'inline-block' }} />
                Qualifier
              </span>
            </>
          )}
          {legendCalTypes.map(ct => (
            <span key={ct.label} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: ct.color }} />
              {ct.label}
            </span>
          ))}
        </div>
      )}

      {/* Create button */}
      <button
        onClick={onCreateCycle}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
      >
        <Plus size={14} />
        New macrocycle
      </button>
    </div>
  );
}
