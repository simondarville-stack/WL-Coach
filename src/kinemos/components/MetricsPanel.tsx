/**
 * MetricsPanel — the numbers a coach came for, and the mass they depend on.
 *
 * Ordered the way the question is asked. "How fast was the second pull" comes
 * before "how long was the transition", so velocity leads and the phase table
 * follows. Power sits with velocity rather than in its own section because it
 * is read in the same glance — and it is absent, with a way to fix that, rather
 * than showing a zero, whenever the bar mass is unknown.
 *
 * Every figure here is derived from the marked track and the calibration. None
 * of it is stored as truth; the analysis row caches it so a trend view can read
 * a season without re-running the pipeline, and this panel always shows the
 * freshly computed values.
 */
import type { CSSProperties } from 'react';
import { Input } from '../../components/ui';
import type { LiftMetrics } from '../engine/phases';
import type { RepSummary } from '../engine/kinematics';
import { num } from '../lib/viewerFormat';

interface MetricsPanelProps {
  metrics: LiftMetrics | null;
  summary: RepSummary | null;
  massKg: number | null;
  massSource: 'logged' | 'manual' | null;
  onMass: (kg: number | null) => void;
  /** Why there are no numbers, when there are none. */
  emptyReason: string | null;
  /** The marked knee height, and the bar's velocity as it passed it on the
   *  way up — null velocity when it never got that high before Vmax. */
  knee?: { heightCm: number; t: number | null; velocityMs: number | null } | null;
}

export function MetricsPanel({
  metrics,
  summary,
  massKg,
  massSource,
  onMass,
  emptyReason,
  knee = null,
}: MetricsPanelProps) {
  const firstPull = metrics?.phases.find(p => p.phaseId === 'first_pull') ?? metrics?.phases[0];
  const secondPull = metrics?.phases.find(p => p.phaseId === 'second_pull') ?? metrics?.phases[2];

  return (
    <>
      <section style={section}>
        <header style={header}>
          <span style={label}>VELOCITY</span>
        </header>

        {!metrics || !summary ? (
          <p style={hint}>{emptyReason ?? 'Mark the bar through the lift to get velocities.'}</p>
        ) : (
          <dl style={list}>
            <Row
              term="First pull"
              value={metrics.phases.length ? unit(firstPull?.peakVelocityMs, 'm/s') : '—'}
              hint="Peak upward velocity through the first pull."
            />
            <Row
              term="Second pull"
              value={unit(secondPull?.peakVelocityMs, 'm/s')}
              hint="Peak upward velocity through the second pull."
            />
            <Row
              term="Loss 1st → 2nd"
              value={transitionLoss(metrics.transitionVelocityLossMs)}
              hint="How much the bar slowed through the transition — the dip a double knee bend produces. A big loss is a coaching signal, not an error; no loss at all usually means a pull from the hang, or a lifter who does not scoop."
            />
            <Row term="Peak" value={unit(metrics.peakVelocityMs, 'm/s')} strong />
            <Row
              term="Turnover"
              value={unit(metrics.turnoverVelocityMs, 'm/s')}
              hint="Mean vertical velocity while the bar is being pulled under."
            />
            <Row
              term="Peak power"
              value={metrics.peakPowerW === null ? '—' : `${num(metrics.peakPowerW, 0)} W`}
              hint="Barbell power: vertical force on the bar times vertical bar velocity. Not system power — the lifter's own mass is not in this model."
            />
            <Row
              term="Peak height"
              value={summary.peakHeightCm ? `${num(summary.peakHeightCm, 1)} cm` : '—'}
            />
          </dl>
        )}

        <div style={{ marginTop: 'var(--space-sm)' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              // The shared Input stretches to its row; without this the "kg"
              // ends up at the far edge of the rail, detached from the number
              // it belongs to.
              justifyContent: 'flex-start',
            }}
          >
            <span style={{ ...label, whiteSpace: 'nowrap' }}>BAR MASS</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={massKg ?? ''}
              placeholder="kg"
              onChange={e => {
                const next = e.target.value.trim();
                onMass(next === '' ? null : Number(next.replace(',', '.')));
              }}
              style={{ width: 76, flex: '0 0 auto', height: 28, fontSize: 'var(--text-caption)' }}
            />
            <span
              style={{
                marginLeft: -4,
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              kg
            </span>
          </label>
          <p style={hint}>
            {massKg === null
              ? 'Power needs a mass. Nothing else does — velocities are unaffected.'
              : massSource === 'logged'
                ? 'From the training log. Change it if the clip shows a different set.'
                : 'Entered by hand.'}
          </p>
        </div>
      </section>

      {metrics && metrics.analyzer.vmaxMs !== null && (
        <section style={section}>
          <header style={header}>
            <span style={label}>ANALYZER</span>
            <span style={{ ...label, letterSpacing: 0 }} title="The measures of the German Weightlifting Analyzer (BVDG teaching material), in EMOS units. Heights are above the bar's start; add the plate's radius for height above the platform.">
              BVDG model
            </span>
          </header>
          <dl style={list}>
            <Row term="V1 · end of first pull" value={unit(metrics.analyzer.v1Ms, 'm/s')} hint="Peak vertical velocity at the end of the first pull." />
            <Row term="V2 · knee passing" value={unit(metrics.analyzer.v2Ms, 'm/s')} hint="Minimum vertical velocity through the transition." />
            {knee && (
              <Row
                term={`V at the knee · ${num(knee.heightCm, 0)} cm`}
                value={knee.velocityMs === null ? 'not reached' : unit(knee.velocityMs, 'm/s')}
                hint={
                  knee.velocityMs === null
                    ? 'The bar never rose to the marked knee height before Vmax — a lift from above the knee, or a mark on the wrong frame.'
                    : `The bar's velocity as it passed the knee you marked${knee.t !== null ? `, at ${num(knee.t, 2)} s` : ''}. V1 and V2 are defined around the knee: if this sits far from both, the phase edges want a look.`
                }
              />
            )}
            <Row term="Vmax" value={unit(metrics.analyzer.vmaxMs, 'm/s')} strong />
            <Row term="Vmin · drop under" value={unit(metrics.analyzer.vminMs, 'm/s')} hint="The lowest (negative) vertical velocity after Vmax." />
            <Row term="t_turn · Vmax → Vmin" value={unit(metrics.analyzer.tTurnS, 's')} hint="Time from Vmax to Vmin — the speed of the lifter under the bar. Käks' third measure." />
            <Row term="S_vmax · height at Vmax" value={cm(metrics.analyzer.sVmaxCm)} />
            <Row term="S_max · top of flight" value={cm(metrics.analyzer.sMaxCm)} hint="The apex before the catch, above the start." />
            <Row term="S_fly · flight" value={cm(metrics.analyzer.sFlyCm)} hint="S_max − S_vmax: how far the bar rises after peak velocity." />
            <Row
              term="S_remain · beyond ballistic"
              value={metrics.analyzer.sRemainPct === null ? '—' : `${num(metrics.analyzer.sRemainPct, 1)} % (${num(metrics.analyzer.sRemainCm ?? 0, 1)} cm)`}
              hint="The flight the impulse alone (Vmax²/2g) does not explain — what the arms and the pull-under added, as a share of S_max."
            />
            <Row term="S_sit · catch height" value={cm(metrics.analyzer.sSitCm)} hint="The bar at the deepest point of the catch, above the start." />
            <Row term="S_fall · into the catch" value={cm(metrics.analyzer.sFallCm)} hint="S_max − S_sit." />
            <Row term="F1 · first pull" value={pct(metrics.analyzer.f1Pct)} hint="Peak vertical force on the bar, as a share of the load. From acceleration alone — no mass needed. 100 % holds the bar still." />
            <Row term="F2 · knee passing" value={pct(metrics.analyzer.f2Pct)} hint="Minimum vertical force through the transition." />
            <Row term="F3 · second pull" value={pct(metrics.analyzer.f3Pct)} hint="Peak vertical force in the second pull." />
            <Row term="Fbr · catch" value={pct(metrics.analyzer.fbrPct)} hint="Peak vertical force braking the bar in the catch." />
            <Row term="PSK · load × Vmax" value={metrics.analyzer.pskNs === null ? '—' : `${num(metrics.analyzer.pskNs, 0)} N·s`} hint="The analyzer's 'power': the bar's momentum at Vmax. Needs the bar mass." />
          </dl>
        </section>
      )}

      {metrics && metrics.phases.length > 0 && (
        <section style={section}>
          <header style={header}>
            <span style={label}>PHASES</span>
          </header>
          <dl style={list}>
            {metrics.phases.map(phase => (
              <div key={phase.phaseId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 3,
                    height: 14,
                    borderRadius: 2,
                    flexShrink: 0,
                    background: phaseColor(phase.phaseId),
                  }}
                />
                <dt
                  style={{
                    flexGrow: 1,
                    fontSize: 'var(--text-label)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {phase.label}
                </dt>
                <dd style={{ margin: 0, fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                  {`${num(phase.durationS, 2)} s`}
                </dd>
                <dd
                  style={{
                    margin: 0,
                    width: 52,
                    textAlign: 'right',
                    fontSize: 'var(--text-label)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {phase.peakVelocityMs === null ? '—' : num(phase.peakVelocityMs, 2)}
                </dd>
              </div>
            ))}
          </dl>
          <p style={hint}>Duration, then the phase’s peak vertical velocity in m/s.</p>
        </section>
      )}
    </>
  );
}

/** Phase colours are DATA — they identify the phase. Read from the metric's own
 *  id so a custom phase set colours correctly without this component knowing
 *  the set. Unknown ids fall back to a neutral rather than borrowing another
 *  phase's meaning. */
function phaseColor(id: string): string {
  const known: Record<string, string> = {
    first_pull: '#3E6E9E',
    transition: '#6E6D67',
    second_pull: '#185FA5',
    turnover: '#A8681F',
    catch: '#3E6E3A',
    pull: '#3E6E9E',
  };
  return known[id] ?? 'var(--color-text-tertiary)';
}

/**
 * The transition dip, said in words when it is not a dip.
 *
 * A negative "loss" means the bar sped up through the transition — no double
 * knee bend to speak of. Printing that as "−0,05 m/s" reads as a loss of five
 * centimetres per second, i.e. the exact opposite of what happened.
 */
function transitionLoss(value: number | null): string {
  if (value === null) return '—';
  if (value <= 0.01) return 'none — no dip';
  return `−${num(value, 2)} m/s`;
}

function unit(value: number | null | undefined, suffix: string): string {
  return value === null || value === undefined ? '—' : `${num(value, 2)} ${suffix}`;
}

function cm(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${num(value, 1)} cm`;
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${num(value, 0)} %`;
}

function Row({
  term,
  value,
  hint: title,
  strong,
}: {
  term: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div
      title={title}
      style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}
    >
      <dt style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>{term}</dt>
      <dd
        style={{
          margin: 0,
          fontSize: 'var(--text-label)',
          fontWeight: strong ? 600 : 400,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

const section: CSSProperties = {
  padding: 'var(--space-md)',
  borderBottom: '1px solid var(--color-border-tertiary)',
};

const header: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 'var(--space-sm)',
};

const label: CSSProperties = {
  fontSize: 'var(--text-caption)',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
};

const hint: CSSProperties = {
  margin: 'var(--space-sm) 0 0',
  fontSize: 'var(--text-caption)',
  lineHeight: 1.4,
  color: 'var(--color-text-tertiary)',
};

const list: CSSProperties = { margin: 0, display: 'grid', gap: 2 };
