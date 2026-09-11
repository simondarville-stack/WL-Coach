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
import { memo, type CSSProperties } from 'react';
import { Input } from '../../components/ui';
import type { LiftFamily, LiftModel } from '../engine/liftModels';
import type { ComputedLift } from '../engine/metricCatalogue';
import { SEXES, WEIGHT_CLASSES, formatBand, referenceBand, type Sex, type WeightClass } from '../engine/referenceBands';
import type { BandsPrefs } from '../lib/displayPrefs';
import type { LiftMetrics } from '../engine/phases';
import type { RepSummary } from '../engine/kinematics';
import { catalogueDelta, describeDelta, velocityThreshold, type MetricDelta } from '../lib/metricDeltas';
import { num } from '../lib/viewerFormat';

interface MetricsPanelProps {
  metrics: LiftMetrics | null;
  summary: RepSummary | null;
  /** The lift model the rep is segmented under (P9): which rows can exist
   *  at all. Absent: every row, as before P9. */
  model?: LiftModel | null;
  massKg: number | null;
  massSource: 'logged' | 'manual' | null;
  onMass: (kg: number | null) => void;
  /** Why there are no numbers, when there are none. */
  emptyReason: string | null;
  /** The marked knee height, and the bar's velocity as it passed it on the
   *  way up — null velocity when it never got that high before Vmax. */
  knee?: { heightCm: number; t: number | null; velocityMs: number | null } | null;
  /** The lift to show each number against — the same one the verdict is
   *  judged by — and how to name it (`22/07`). Null: no Δ column. */
  earlier?: { lift: ComputedLift; label: string } | null;
  /** The grade's error margin on velocity, m/s: a velocity difference
   *  inside it is "same" here as in the verdict. */
  marginMs?: number | null;
  /**
   * The BVDG orientation values beside each number (P9 plan §6), a toggle
   * that is OFF by default: national-squad figures per weight class and
   * sex, picked by the coach here until the athlete carries them. Absent:
   * no toggle.
   */
  bands?: {
    prefs: BandsPrefs;
    onChange: (patch: Partial<BandsPrefs>) => void;
    /** The athlete's own sex and weight-class tier, when the profile has
     *  them: used in place of the coach's pick, and said so. */
    athlete?: { sex: Sex; tier: WeightClass } | null;
  };
}

function MetricsPanelImpl({
  metrics,
  summary,
  model = null,
  massKg,
  massSource,
  onMass,
  emptyReason,
  knee = null,
  earlier = null,
  marginMs = null,
  bands,
}: MetricsPanelProps) {
  // A band beside a value, as the material prints it, when the coach has
  // switched them on and the tables cover this lift's family.
  const family: LiftFamily = model?.family ?? 'snatch';
  const bandClass: WeightClass = bands?.athlete?.tier ?? bands?.prefs.weightClass ?? 'middle';
  const bandSex: Sex = bands?.athlete?.sex ?? bands?.prefs.sex ?? 'men';
  const bandFor = (metricId: string, decimals: number): string | null => {
    if (!bands?.prefs.on) return null;
    const band = referenceBand(metricId, family, bandClass, bandSex);
    return band ? formatBand(band, decimals) : null;
  };
  const firstPull = metrics?.phases.find(p => p.phaseId === 'first_pull') ?? null;
  const secondPull = metrics?.phases.find(p => p.phaseId === 'second_pull') ?? null;
  // What this lift can have at all. A row for a phase the model does not
  // name is not a dash, it is absent (P9 plan §3.3).
  const has = (phaseId: string) => (model ? (model.phaseSet ?? []).some(p => p.id === phaseId) : true);
  const caught = model ? model.shape === 'pull-catch' || model.shape === 'dip-drive' : true;
  const jerk = metrics?.jerk ?? null;

  // The Δ column. Rows that are catalogue metrics go through the catalogue
  // (its thresholds and its sense of better); the analyzer's own rows that
  // are not in it are read directly with the same rules.
  const current: ComputedLift | null = metrics ? { metrics, summary } : null;
  const withDelta = earlier !== null && current !== null;
  const d = (id: string, words?: [string, string]): MetricDelta | null =>
    withDelta ? catalogueDelta(id, current, earlier.lift, marginMs, words) : null;
  const dv = (read: (l: ComputedLift) => number | null, words?: [string, string], betterWhen: 'higher' | 'lower' | null = null) =>
    withDelta
      ? describeDelta(read(current), read(earlier.lift), {
          decimals: 2,
          betterWhen,
          threshold: velocityThreshold(0.03, marginMs),
          words,
        })
      : null;
  const deltaHeader = withDelta ? `Δ vs ${earlier.label}` : null;

  return (
    <>
      <section style={section}>
        <header style={header}>
          <span style={label}>VELOCITY</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {bands && (
              <>
                {bands.prefs.on && bands.athlete && (
                  <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }} title="From the athlete's profile: sex, and the tier of their weight class or bodyweight">
                    {`${SEXES.find(s => s.id === bands.athlete!.sex)?.label} · ${WEIGHT_CLASSES.find(c => c.id === bands.athlete!.tier)?.label}`}
                  </span>
                )}
                {bands.prefs.on && !bands.athlete && (
                  <>
                    <select
                      value={bands.prefs.weightClass}
                      onChange={e => bands.onChange({ weightClass: e.target.value as BandsPrefs['weightClass'] })}
                      aria-label="Weight class for the reference bands"
                      style={miniSelect}
                    >
                      {WEIGHT_CLASSES.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={bands.prefs.sex}
                      onChange={e => bands.onChange({ sex: e.target.value as BandsPrefs['sex'] })}
                      aria-label="Sex for the reference bands"
                      style={miniSelect}
                    >
                      {SEXES.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button
                  type="button"
                  aria-pressed={bands.prefs.on}
                  onClick={() => bands.onChange({ on: !bands.prefs.on })}
                  title="The BVDG orientation values (Sandau, Jentsch & Lippmann) beside each number, per weight class and sex. National-squad figures: a reference, not a verdict."
                  style={miniToggle(bands.prefs.on)}
                >
                  bands
                </button>
              </>
            )}
            {deltaHeader && (
              <span style={{ ...label, letterSpacing: 0 }} title="Against the lift the verdict uses · inside the threshold = same">
                {deltaHeader}
              </span>
            )}
          </span>
        </header>

        {!metrics || !summary ? (
          <p style={hint}>{emptyReason ?? 'Mark the bar to get velocities.'}</p>
        ) : (
          <dl style={list}>
            {has('first_pull') && (
              <Row
                term="First pull" band={bandFor('firstPull', 2)}
                value={unit(firstPull?.peakVelocityMs, 'm/s')}
                hint="Peak upward velocity through the first pull."
                delta={d('firstPull', ['faster', 'slower'])}
                withDelta={withDelta}
              />
            )}
            {has('second_pull') && (
              <Row
                term="Second pull"
                value={unit(secondPull?.peakVelocityMs, 'm/s')}
                hint="Peak upward velocity through the second pull."
                delta={d('secondPull')}
                withDelta={withDelta}
              />
            )}
            {has('first_pull') && has('transition') && (
              <Row
                term="Loss 1st → 2nd" band={bandFor('transitionLoss', 2)}
                value={transitionLoss(metrics.transitionVelocityLossMs)}
                hint="The transition dip · a coaching signal, not an error"
                delta={d('transitionLoss')}
                withDelta={withDelta}
              />
            )}
            <Row term="Peak" band={bandFor('peakVelocity', 2)} value={unit(metrics.peakVelocityMs, 'm/s')} strong delta={d('peakVelocity')} withDelta={withDelta} />
            <Row
              term="Mean, rise"
              value={unit(summary.meanRiseVelocityMs, 'm/s')}
              hint="Average upward velocity from the bar leaving its rest to its apex."
              delta={d('meanRiseVelocity')}
              withDelta={withDelta}
            />
            <Row
              term="Time to Vmax"
              value={unit(summary.timeToPeakVelocityS, 's')}
              hint="From the bar leaving its rest to peak velocity."
              delta={d('timeToPeakVelocity')}
              withDelta={withDelta}
            />
            <Row
              term="Time to peak power"
              value={unit(summary.timeToPeakPowerS, 's')}
              hint="From the bar leaving its rest to peak barbell power · needs a mass"
              delta={d('timeToPeakPower')}
              withDelta={withDelta}
            />
            <Row
              term="Rise"
              value={unit(summary.concentricS, 's')}
              hint="From the bar leaving its rest to its apex."
              delta={d('concentric')}
              withDelta={withDelta}
            />
            {has('turnover') && (
              <Row
                term="Turnover"
                value={unit(metrics.turnoverVelocityMs, 'm/s')}
                hint="Mean vertical velocity while the bar is being pulled under."
                delta={d('turnover')}
                withDelta={withDelta}
              />
            )}
            <Row
              term="Peak power"
              value={metrics.peakPowerW === null ? '—' : `${num(metrics.peakPowerW, 0)} W`}
              hint="Barbell power · not system power"
              delta={d('peakPower')}
              withDelta={withDelta}
            />
            <Row
              term="Peak power / bodyweight"
              value={metrics.peakPowerPerKgBwW === null ? '—' : `${num(metrics.peakPowerPerKgBwW, 1)} W/kg`}
              hint="Barbell power per kilo of lifter · the power figure that survives a comparison across body sizes · needs the bar mass and the athlete's bodyweight"
              delta={d('peakPowerPerKg')}
              withDelta={withDelta}
            />
            <Row
              term="Peak height"
              value={summary.peakHeightCm ? `${num(summary.peakHeightCm, 1)} cm` : '—'}
              delta={d('peakHeight')}
              withDelta={withDelta}
            />
            <Row
              term="Path length"
              value={summary.pathLengthCm ? `${num(summary.pathLengthCm, 0)} cm` : '—'}
              hint="How far the bar end travelled in all."
              delta={d('pathLength')}
              withDelta={withDelta}
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
              ? 'Power needs a mass; velocities do not.'
              : massSource === 'logged'
                ? 'From the training log.'
                : 'Entered by hand.'}
          </p>
        </div>
      </section>

      {jerk && (
        <section style={section}>
          <header style={header}>
            <span style={label}>JERK</span>
            <span style={{ ...label, letterSpacing: 0 }} title="The Weightlifting Analyzer's jerk measures · BVDG parameter table">
              BVDG model
            </span>
          </header>
          <dl style={list}>
            <Row term="v_Auft · dip velocity" band={bandFor('vDip', 2)} value={unit(jerk.vDipMs, 'm/s')} hint="Peak downward velocity in the dip · about −1,0 to −1,1 m/s in the tables" delta={d('vDip')} withDelta={withDelta} />
            <Row term="δ_Auf · dip depth" band={bandFor('sDip', 1)} value={cm(jerk.sDipCm)} hint="Start to the lower turning point · 16–22 cm by weight class" delta={d('sDip', ['deeper', 'shallower'])} withDelta={withDelta} />
            <Row term="δ_Auf · % of height" value={jerk.sDipPctHeight === null ? '—' : `${num(jerk.sDipPctHeight, 1)} %`} hint="The dip as a share of the lifter’s standing height · needs the height on the athlete" delta={d('sDipPctHeight')} withDelta={withDelta} />
            <Row term="δv_Auf · to fastest descent" value={cm(jerk.sToVDipCm)} hint="How far the bar had descended at v_Auft · about 10 cm" />
            <Row term="δ_Stoß · drive path" value={cm(jerk.sDriveCm)} hint="Lower turning point to the height at Vmax" delta={d('sDrive', ['longer', 'shorter'])} withDelta={withDelta} />
            <Row term="Drive − dip" value={cm(jerk.driveMinusDipCm)} strong hint="3–4 cm is the target: the drive goes on past where the dip began" delta={d('driveMinusDip')} withDelta={withDelta} />
            <Row term="F_Auf · braking" band={bandFor('fDip', 0)} value={pct(jerk.fDipPct)} hint="Peak vertical force while the dip is braked · about 180 %" delta={d('fDip')} withDelta={withDelta} />
            <Row
              term="F_Stoß · drive" band={bandFor('fDrive', 0)}
              value={jerk.fDrivePct === null ? '—' : `${pct(jerk.fDrivePct)}${jerk.driveForcePeaks !== null ? ` · ${jerk.driveForcePeaks} ${jerk.driveForcePeaks === 1 ? 'peak' : 'peaks'}` : ''}`}
              hint="Peak vertical force in the drive · 180–190 % with two maxima, 220–230 % with one"
              delta={d('fDrive')}
              withDelta={withDelta}
            />
            <Row term="Auftakt" value={unit(jerk.dipS !== null ? jerk.dipS + (jerk.brakingS ?? 0) : null, 's')} hint="Dip and braking together · 0,45–0,50 s in the material" delta={d('dipDuration')} withDelta={withDelta} />
            <Row term="Anstoß" value={unit(jerk.driveS, 's')} hint="The drive · about 0,25 s" delta={d('driveDuration')} withDelta={withDelta} />
          </dl>
        </section>
      )}

      {metrics && metrics.analyzer.vmaxMs !== null && caught && (
        <section style={section}>
          <header style={header}>
            <span style={label}>ANALYZER</span>
            <span style={{ ...label, letterSpacing: 0 }} title="German Weightlifting Analyzer measures · heights above the bar’s start">
              BVDG model
            </span>
          </header>
          <dl style={list}>
            {has('first_pull') && (
              <Row term="V1 · end of first pull" value={unit(metrics.analyzer.v1Ms, 'm/s')} hint="Peak vertical velocity at the end of the first pull." delta={dv(l => l.metrics.analyzer?.v1Ms ?? null, ['faster', 'slower'])} withDelta={withDelta} />
            )}
            {has('transition') && (
              <Row term="V2 · knee passing" band={bandFor('v2', 2)} value={unit(metrics.analyzer.v2Ms, 'm/s')} hint="Minimum vertical velocity through the transition." delta={d('v2', ['faster', 'slower'])} withDelta={withDelta} />
            )}
            {knee && (
              <Row
                term={`V at the knee · ${num(knee.heightCm, 0)} cm`}
                value={knee.velocityMs === null ? 'not reached' : unit(knee.velocityMs, 'm/s')}
                hint={
                  knee.velocityMs === null
                    ? 'The bar never reached the marked knee before Vmax'
                    : `At the marked knee${knee.t !== null ? ` · ${num(knee.t, 2)} s` : ''} · far from V1 and V2 = check the phase edges`
                }
              />
            )}
            <Row term="Vmax" band={bandFor('peakVelocity', 2)} value={unit(metrics.analyzer.vmaxMs, 'm/s')} strong delta={dv(l => l.metrics.analyzer?.vmaxMs ?? null, undefined, 'higher')} withDelta={withDelta} />
            <Row term="Vmin · drop under" band={bandFor('vmin', 2)} value={unit(metrics.analyzer.vminMs, 'm/s')} hint="The lowest (negative) vertical velocity after Vmax." delta={d('vmin')} withDelta={withDelta} />
            <Row term="t_turn · Vmax → Vmin" band={bandFor('tTurn', 3)} value={unit(metrics.analyzer.tTurnS, 's')} hint="Vmax → Vmin · the lifter under the bar" delta={d('tTurn')} withDelta={withDelta} />
            <Row term="S_vmax · height at Vmax" value={cm(metrics.analyzer.sVmaxCm)} delta={d('sVmax', ['later in the pull', 'earlier in the pull'])} withDelta={withDelta} />
            <Row
              term="S_max · top of flight"
              value={cm(metrics.analyzer.sMaxCm)}
              hint="The apex before the catch, above the start."
              delta={
                withDelta
                  ? describeDelta(metrics.analyzer.sMaxCm, earlier.lift.metrics.analyzer?.sMaxCm ?? null, { decimals: 1, betterWhen: null, threshold: 1 })
                  : null
              }
              withDelta={withDelta}
            />
            <Row term="S_fly · flight" value={cm(metrics.analyzer.sFlyCm)} hint="S_max − S_vmax: how far the bar rises after peak velocity." delta={d('sFly', ['longer', 'shorter'])} withDelta={withDelta} />
            <Row
              term="S_remain · beyond ballistic" band={bandFor('sRemain', 0)}
              value={metrics.analyzer.sRemainPct === null ? '—' : `${num(metrics.analyzer.sRemainPct, 1)} % (${num(metrics.analyzer.sRemainCm ?? 0, 1)} cm)`}
              hint="Flight beyond Vmax²/2g · what the arms and pull-under added"
              delta={d('sRemain', ['more', 'less'])}
              withDelta={withDelta}
            />
            <Row term="S_sit · catch height" value={cm(metrics.analyzer.sSitCm)} hint="The bar at the deepest point of the catch, above the start." delta={d('sSit')} withDelta={withDelta} />
            <Row term="S_fall · into the catch" band={bandFor('sFall', 1)} value={cm(metrics.analyzer.sFallCm)} hint="S_max − S_sit." delta={d('sFall', ['further', 'less far'])} withDelta={withDelta} />
            {has('first_pull') && (
              <Row term="F1 · first pull" band={bandFor('f1', 0)} value={pct(metrics.analyzer.f1Pct)} hint="Peak vertical force, % of load · 100 % holds the bar still" delta={d('f1')} withDelta={withDelta} />
            )}
            {has('transition') && (
              <Row term="F2 · knee passing" band={bandFor('f2', 0)} value={pct(metrics.analyzer.f2Pct)} hint="Minimum vertical force through the transition." delta={d('f2')} withDelta={withDelta} />
            )}
            {has('second_pull') && (
              <Row term="F3 · second pull" band={bandFor('f3', 0)} value={pct(metrics.analyzer.f3Pct)} hint="Peak vertical force in the second pull." delta={d('f3')} withDelta={withDelta} />
            )}
            <Row term="Fbr · catch" band={bandFor('fbr', 0)} value={pct(metrics.analyzer.fbrPct)} hint="Peak vertical force braking the bar in the catch." delta={d('fbr')} withDelta={withDelta} />
            <Row
              term="PSK · load × Vmax"
              value={metrics.analyzer.pskNs === null ? '—' : `${num(metrics.analyzer.pskNs, 0)} N·s`}
              hint="Momentum at Vmax · needs the bar mass"
              delta={
                withDelta
                  ? describeDelta(metrics.analyzer.pskNs, earlier.lift.metrics.analyzer?.pskNs ?? null, { decimals: 0, betterWhen: 'higher', threshold: 5 })
                  : null
              }
              withDelta={withDelta}
            />
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
          <p style={hint}>Duration · peak vertical velocity (m/s)</p>
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
  delta = null,
  withDelta = false,
  band = null,
}: {
  term: string;
  value: string;
  hint?: string;
  strong?: boolean;
  /** This number against the earlier lift's. */
  delta?: MetricDelta | null;
  /** Whether the Δ column exists on this table at all — a row with nothing
   *  to say still keeps the column, so the values stay aligned. */
  withDelta?: boolean;
  /** The reference band, printed, when the coach has them on. */
  band?: string | null;
}) {
  return (
    <div
      title={title}
      style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}
    >
      <dt style={{ flexGrow: 1, minWidth: 0, fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>{term}</dt>
      {band && (
        <dd
          style={{ margin: 0, fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}
          title="BVDG orientation value"
        >
          {band}
        </dd>
      )}
      <dd
        style={{
          margin: 0,
          fontSize: 'var(--text-label)',
          fontWeight: strong ? 600 : 400,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </dd>
      {withDelta && (
        <dd
          style={{
            margin: 0,
            width: 128,
            flexShrink: 0,
            textAlign: 'right',
            fontSize: 'var(--text-caption)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            color: deltaColor(delta?.tone ?? 'same'),
          }}
        >
          {delta?.text ?? '—'}
        </dd>
      )}
    </div>
  );
}

/** Green for better, red for worse — and a word alongside, always, because
 *  colour never carries the meaning alone. */
function deltaColor(tone: MetricDelta['tone']): string {
  switch (tone) {
    case 'better':
      return 'var(--color-success-text)';
    case 'worse':
      return 'var(--color-danger-text)';
    case 'neutral':
      return 'var(--color-text-secondary)';
    default:
      return 'var(--color-text-tertiary)';
  }
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

const miniSelect: CSSProperties = {
  padding: '0 4px',
  height: 20,
  borderRadius: 'var(--radius-sm)',
  border: '0.5px solid var(--color-border-secondary)',
  background: 'var(--color-bg-primary)',
  color: 'var(--color-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-caption)',
};

function miniToggle(on: boolean): CSSProperties {
  return {
    padding: '0 8px',
    height: 20,
    borderRadius: 'var(--radius-sm)',
    border: on ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-secondary)',
    background: on ? 'var(--color-accent)' : 'var(--color-bg-primary)',
    color: on ? 'var(--color-text-on-accent)' : 'var(--color-text-tertiary)',
    fontFamily: 'inherit',
    fontSize: 'var(--text-caption)',
    cursor: 'pointer',
  };
}

export const MetricsPanel = memo(MetricsPanelImpl);
