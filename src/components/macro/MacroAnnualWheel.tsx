import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { MacroCycle, MacroPhase, MacroCompetition } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import {
  drawAnnualWheel,
  overlapsYear, dateInYear,
  getPhaseColor,
  MACRO_COLORS, CAL_EVENT_COLORS, CAL_EVENT_LABELS,
  SIZE, CX, CY, PI2,
} from '../../lib/annualWheelRenderer';
import type { CalendarEvent, HitZone } from '../../lib/annualWheelRenderer';

interface MacroAnnualWheelProps {
  macrocycles: MacroCycle[];
  onSelectCycle: (cycle: MacroCycle) => void;
  onCreateCycle: () => void;
  athleteName?: string;
  groupName?: string;
  athleteId?: string;
  groupId?: string;
}

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

  // ── Render ──────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    hitZonesRef.current = drawAnnualWheel({
      ctx, year, macrocycles, allPhases, allComps, calendarEvents,
      macroColorMap: macroColorMap.current, athleteName, groupName,
    });
  }, [year, macrocycles, allPhases, allComps, calendarEvents, athleteName, groupName]);

  useEffect(() => { render(); }, [render]);

  // Re-render on color scheme change
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => render();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [render]);

  // ── Hit testing ─────────────────────────────────────────────────────
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

  const getMousePos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = SIZE / rect.width;
    return { mx: (e.clientX - rect.left) * sx, my: (e.clientY - rect.top) * sx };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
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

  // ── Legend (derived from data) ───────────────────────────────────────
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

  // ── JSX ──────────────────────────────────────────────────────────────
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

      {/* Legend */}
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
