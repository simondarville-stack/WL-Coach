import { METRICS, type MetricKey, type ComputedMetrics, formatMetricValue } from '../../lib/metrics';

interface MetricStripProps {
  metrics: ComputedMetrics;
  visibleMetrics: MetricKey[];
  size?: 'sm' | 'md' | 'lg';      // sm = day card, md = week strip, lg = panel
  showLabels?: boolean;             // true = "R 136", false = just "136"
  separator?: string;               // "·" or "|" or nothing
  className?: string;
}

export function MetricStrip({
  metrics,
  visibleMetrics,
  size = 'md',
  showLabels = true,
  separator = '·',
  className = '',
}: MetricStripProps) {
  const textSize = size === 'sm' ? 'text-[11px]' : size === 'lg' ? 'text-sm' : 'text-xs';
  const valueWeight = 'font-medium';

  const items = METRICS
    .filter(m => visibleMetrics.includes(m.key))
    .map(m => ({
      key: m.key,
      label: showLabels ? m.shortLabel : '',
      value: formatMetricValue(m.key, metrics[m.key]),
    }))
    .filter(item => item.value !== '—' && item.value !== '0');

  if (items.length === 0) return null;

  return (
    <div className={`inline-flex items-center gap-1.5 ${textSize} ${className}`}>
      {items.map((item, i) => (
        <span key={item.key}>
          {i > 0 && separator && (
            <span className="text-gray-300 mx-0.5">{separator}</span>
          )}
          {item.label && <span className="text-gray-400">{item.label} </span>}
          <span className={`text-gray-700 ${valueWeight}`}>{item.value}</span>
        </span>
      ))}
    </div>
  );
}
