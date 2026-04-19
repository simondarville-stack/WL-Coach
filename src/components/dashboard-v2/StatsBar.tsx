import { Users, CalendarCheck, AlertTriangle, Calendar, TrendingUp, Activity } from 'lucide-react';
import type { AthleteSnapshot, WeeklyOverview, UpcomingEventV2, AttentionItem } from '../../hooks/useCoachDashboardV2';

interface Props {
  athletes: AthleteSnapshot[];
  weekOverview: WeeklyOverview | null;
  upcomingEvents: UpcomingEventV2[];
  attentionItems: AttentionItem[];
}

export function StatsBar({ athletes, weekOverview, upcomingEvents, attentionItems }: Props) {
  const activeMacros = athletes.filter(a => a.macrocycle).length;
  const avgRaw = (() => {
    const vals = athletes.map(a => a.rawAverage).filter((r): r is number => r !== null);
    return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  })();

  const cards = [
    {
      label: 'Athletes',
      value: athletes.length,
      sub: `${activeMacros} with active cycle`,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'This week',
      value: weekOverview ? `${weekOverview.athletesPlanned}/${athletes.length}` : '-',
      sub: weekOverview && weekOverview.athletesNotPlanned > 0
        ? `${weekOverview.athletesNotPlanned} need planning`
        : 'All planned',
      icon: CalendarCheck,
      color: weekOverview && weekOverview.athletesNotPlanned > 0 ? 'text-amber-600' : 'text-green-600',
      bg: weekOverview && weekOverview.athletesNotPlanned > 0 ? 'bg-amber-50' : 'bg-green-50',
    },
    {
      label: 'Avg RAW',
      value: avgRaw ?? '-',
      sub: avgRaw !== null
        ? Number(avgRaw) >= 10 ? 'Good readiness' : Number(avgRaw) >= 7 ? 'Moderate' : 'Low readiness'
        : 'No data',
      icon: Activity,
      color: avgRaw !== null ? (Number(avgRaw) >= 10 ? 'text-green-600' : Number(avgRaw) >= 7 ? 'text-amber-600' : 'text-red-600') : 'text-gray-400',
      bg: avgRaw !== null ? (Number(avgRaw) >= 10 ? 'bg-green-50' : Number(avgRaw) >= 7 ? 'bg-amber-50' : 'bg-red-50') : 'bg-gray-50',
    },
    {
      label: 'Events',
      value: upcomingEvents.length,
      sub: upcomingEvents.length > 0
        ? `Next in ${upcomingEvents[0].daysUntil}d`
        : 'None upcoming',
      icon: Calendar,
      color: 'text-teal-600',
      bg: 'bg-teal-50',
    },
    {
      label: 'Active cycles',
      value: activeMacros,
      sub: `${athletes.length - activeMacros} without`,
      icon: TrendingUp,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Attention',
      value: attentionItems.filter(a => a.severity === 'alert').length,
      sub: `${attentionItems.filter(a => a.severity === 'warning').length} warnings`,
      icon: AlertTriangle,
      color: attentionItems.some(a => a.severity === 'alert') ? 'text-red-600' : 'text-gray-400',
      bg: attentionItems.some(a => a.severity === 'alert') ? 'bg-red-50' : 'bg-gray-50',
    },
  ];

  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
      {cards.map(card => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <div className={`p-1 rounded ${card.bg}`}>
                <Icon size={13} className={card.color} />
              </div>
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{card.label}</span>
            </div>
            <div className="text-lg font-medium text-gray-900 leading-tight">{card.value}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{card.sub}</div>
          </div>
        );
      })}
    </div>
  );
}
