import { AlertTriangle, AlertCircle, CalendarX, Activity, UserX } from 'lucide-react';
import type { AttentionItem } from '../../hooks/useCoachDashboardV2';

interface Props {
  items: AttentionItem[];
}

const iconMap: Record<AttentionItem['type'], typeof AlertTriangle> = {
  no_plan: CalendarX,
  inactive: UserX,
  low_raw: Activity,
  low_compliance: AlertTriangle,
  off_target: AlertCircle,
};

export function AttentionPanel({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Attention needed</h3>
        <div className="text-sm text-gray-400 text-center py-4">All clear -- no issues detected.</div>
      </div>
    );
  }

  const alerts = items.filter(i => i.severity === 'alert');
  const warnings = items.filter(i => i.severity === 'warning');

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="px-3 py-2 border-b border-gray-100">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Attention needed</h3>
      </div>
      <div className="divide-y divide-gray-50 max-h-[300px] overflow-y-auto">
        {alerts.map((item, i) => (
          <AttentionRow key={`a-${i}`} item={item} />
        ))}
        {warnings.map((item, i) => (
          <AttentionRow key={`w-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = iconMap[item.type] || AlertTriangle;
  const isAlert = item.severity === 'alert';

  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <div className={`p-1 rounded ${isAlert ? 'bg-red-50' : 'bg-amber-50'}`}>
        <Icon size={12} className={isAlert ? 'text-red-500' : 'text-amber-500'} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-gray-800">{item.athleteName}</span>
        <span className="text-[11px] text-gray-400 ml-1.5">{item.message}</span>
      </div>
    </div>
  );
}
