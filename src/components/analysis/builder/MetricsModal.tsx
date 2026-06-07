// The Metric Registry surface: lists every metric (built-in + coach-defined)
// with its unit, kind, planned/performed applicability and formula, and lets
// the coach add/delete derived metrics through a guided composer. This is the
// runtime configurability invariant (#2) made visible.

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal, Button, Input, Select } from '../../ui';
import type { MetricDef } from '../../../lib/analysis';
import { OP_LABEL, type CoachMetricSpec, type DerivedOp } from './coachMetrics';

interface MetricsModalProps {
  isOpen: boolean;
  onClose: () => void;
  metrics: MetricDef[];
  baseMetrics: MetricDef[];
  onAdd: (spec: CoachMetricSpec) => void;
  onDelete: (id: string) => void;
}

export function MetricsModal({ isOpen, onClose, metrics, baseMetrics, onAdd, onDelete }: MetricsModalProps) {
  const [label, setLabel] = useState('');
  const [a, setA] = useState(baseMetrics[0]?.id ?? '');
  const [b, setB] = useState(baseMetrics[1]?.id ?? baseMetrics[0]?.id ?? '');
  const [op, setOp] = useState<DerivedOp>('ratioPct');

  const slug = (s: string) =>
    'custom_' + s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const canAdd = label.trim() !== '' && a && b && !metrics.some((m) => m.id === slug(label));

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd({ id: slug(label), label: label.trim(), unit: op === 'ratioPct' ? '%' : '', a, b, op });
    setLabel('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Analysis metrics" size="lg">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-label)' }}>
        <thead>
          <tr>
            {['Metric', 'Unit', 'Kind', 'States', 'Formula', ''].map((h) => (
              <th key={h} style={thStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.id}>
              <td style={tdStyle}>{m.label}</td>
              <td style={tdStyle}>{m.unit || '—'}</td>
              <td style={{ ...tdStyle, color: 'var(--color-text-tertiary)' }}>{m.kind}</td>
              <td style={{ ...tdStyle, color: 'var(--color-text-tertiary)' }}>{m.appliesToState.join(' / ')}</td>
              <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {m.kind === 'derived' ? m.inputs.map((i) => i.metricId).join(', ') : (m.description ?? '—')}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {!m.isBuiltin && (
                  <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} onClick={() => onDelete(m.id)} aria-label={`Delete ${m.label}`} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 'var(--space-xl)', borderTop: '0.5px solid var(--color-border-tertiary)', paddingTop: 'var(--space-lg)' }}>
        <div style={{ fontSize: 'var(--text-caption)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-sm)', fontWeight: 500 }}>
          New derived metric
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px', minWidth: 120 }}>
            <Input placeholder="Label, e.g. Pull share" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div style={{ width: 130 }}>
            <Select value={a} onChange={(e) => setA(e.target.value)}>
              {baseMetrics.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </Select>
          </div>
          <div style={{ width: 120 }}>
            <Select value={op} onChange={(e) => setOp(e.target.value as DerivedOp)}>
              {(Object.keys(OP_LABEL) as DerivedOp[]).map((o) => (
                <option key={o} value={o}>{OP_LABEL[o]}</option>
              ))}
            </Select>
          </div>
          <div style={{ width: 130 }}>
            <Select value={b} onChange={(e) => setB(e.target.value)}>
              {baseMetrics.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </Select>
          </div>
          <Button variant="primary" size="md" onClick={handleAdd} disabled={!canAdd}>
            Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 400,
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  padding: '6px 8px',
  borderBottom: '0.5px solid var(--color-border-secondary)',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 8px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  color: 'var(--color-text-primary)',
};
