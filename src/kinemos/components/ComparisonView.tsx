/**
 * ComparisonView — two lifts, laid on top of each other.
 *
 * Design §8 ranks this first among comparison needs: overlay two paths, synced
 * by a phase marker. The coach's question is "why did that one fail when the
 * one last month made it", so the two paths are the first and largest thing
 * here — a coach reads the shape before any number.
 *
 * Three details are load-bearing:
 *
 *   - **The paths open at equal aspect.** A bar path auto-stretched to fill its
 *     box lies about the loop, which is the whole thing being compared. The
 *     viewBox is in centimetres and `preserveAspectRatio` keeps it square. A
 *     horizontal exaggeration is offered — a metre-tall pull with an 8 cm loop
 *     is otherwise a ribbon in an empty box — but it is chosen, stated, and
 *     drawn into the scale bar rather than applied silently.
 *   - **The alignment is named on screen.** Two curves aligned on lift-off and
 *     two aligned on peak velocity tell different stories, and the reader has
 *     to know which one they are being told.
 *   - **A delta says which direction is better, in words.** +0,04 m/s of peak
 *     velocity is an improvement; +0,04 m/s of velocity lost through the
 *     transition is not; +4 cm of loop width is neither. Colour is never the
 *     only carrier of that (design brief, hard conventions).
 */
import { X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Select, Spinner } from '../../components/ui';
import {
  ALIGNMENT_LABEL,
  ALIGNMENT_WHY,
  alignSeries,
  compareMetrics,
  comparisonCaveats,
  massesAreComparable,
  type AlignedSeries,
  type AlignmentAnchor,
  type MetricDelta,
} from '../engine/compare';
import type { KinematicSeries, RepSummary } from '../engine/kinematics';
import type { LiftMetrics, PhaseBoundary } from '../engine/phases';
import { formatDateShort } from '../../lib/dateUtils';
import type { KinemosTrackPoint } from '../../lib/database.types';
import type { ComparisonCandidate, ComparisonSubject } from '../lib/comparisonService';
import { useFollowerFrame, type UseFollowerFrame } from '../hooks/useFollowerFrame';
import type { UseFrameServer } from '../hooks/useFrameServer';
import { ClipStage } from './ClipStage';
import { ViewerTransport } from './ViewerTransport';
import { clipTime, num } from '../lib/viewerFormat';

/** The lift on screen. Accent, because it is the one being judged. */
const CURRENT_COLOR = '#185FA5';
/** The one it is judged against. Deliberately quieter — it is the reference,
 *  not the subject. */
const REFERENCE_COLOR = '#8B8A83';

export interface ComparisonSide {
  label: string;
  date: string | null;
  /** The track in this clip's own display-space pixels, for drawing the path
   *  onto the video in side-by-side mode. */
  points: KinemosTrackPoint[];
  series: KinematicSeries;
  boundaries: PhaseBoundary[];
  metrics: LiftMetrics;
  summary: RepSummary;
  grade: string | null;
  massKg: number | null;
  phaseSetId: string;
}

/** What the comparison shows. Two readings of the same two lifts, not two
 *  features: the charts answer "what differed", the clips answer "what did it
 *  look like". */
type ComparisonMode = 'curves' | 'video';

const MODE_LABEL: Record<ComparisonMode, string> = {
  curves: 'Charts',
  video: 'Side by side',
};

interface ComparisonViewProps {
  current: ComparisonSide;
  candidates: ComparisonCandidate[];
  selectedId: string | null;
  onSelect: (analysisId: string | null) => void;
  subject: ComparisonSubject | null;
  loading: boolean;
  anchor: AlignmentAnchor;
  onAnchor: (anchor: AlignmentAnchor) => void;
  onClose: () => void;
  /**
   * The current lift's playhead — the viewer's own, passed in rather than
   * opened again. Side-by-side playback has exactly one clock, and this is it;
   * the reference clip follows the time this one is at. Two clocks drift, and
   * the drift looks like a decoding bug rather than a design mistake.
   */
  playback: UseFrameServer;
}

export function ComparisonView({
  current,
  candidates,
  selectedId,
  onSelect,
  subject,
  loading,
  anchor,
  onAnchor,
  onClose,
  playback,
}: ComparisonViewProps) {
  const currentAligned = alignSeries(current.series, current.boundaries, anchor);
  const referenceAligned = subject ? alignSeries(subject.series, subject.boundaries, anchor) : null;

  /**
   * A moment on the aligned clock, shared by both panels. The delta table
   * answers "which lift was faster"; this answers the question a coach asks
   * next and cannot get from a table — *where* the two diverged, and where the
   * bar was at that instant in each. One hover, both panels.
   */
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [mode, setMode] = useState<ComparisonMode>('curves');

  // ── The one clock ─────────────────────────────────────────────────────────
  //
  // The leader is at some time in its own clip. Subtracting its anchor puts
  // that on the aligned clock; adding the reference's anchor puts it back into
  // the reference's clip. Nothing here is in frames: the two clips are usually
  // different frame rates and one of them is often variable, so the offset
  // between them is a fraction of a frame that no index arithmetic can carry.
  const leaderT = playback.server?.timestamps[playback.index] ?? null;
  const alignedT = leaderT === null ? null : leaderT - currentAligned.anchorT;
  const referenceSrc =
    mode === 'video' && subject && !subject.clip.isEmbed ? subject.clip.playbackUrl : null;
  const referenceT =
    alignedT === null || !referenceAligned ? null : alignedT + referenceAligned.anchorT;
  const follower = useFollowerFrame(referenceSrc, referenceT);

  const referenceMass =
    subject && subject.analysis.mass_kg !== null ? Number(subject.analysis.mass_kg) : null;

  const deltas: MetricDelta[] = subject
    ? compareMetrics(
        { metrics: subject.metrics, summary: subject.summary },
        { metrics: current.metrics, summary: current.summary },
        { massesComparable: massesAreComparable(referenceMass, current.massKg) },
      )
    : [];

  const caveats = subject
    ? comparisonCaveats(
        {
          grade: subject.analysis.grade,
          massKg: referenceMass,
          phaseSetId: subject.analysis.phase_set_id,
        },
        { grade: current.grade, massKg: current.massKg, phaseSetId: current.phaseSetId },
      )
    : [];

  const referenceLabel = subject
    ? [subject.clip.exerciseName, subject.clip.date ? formatDateShort(subject.clip.date) : null]
        .filter(Boolean)
        .join(' · ')
    : 'nothing selected';

  return (
    <div
      style={{
        flexGrow: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-page)',
      }}
    >
      {/* Controls */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-md)',
          padding: 'var(--space-sm) var(--space-lg)',
          background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border-tertiary)',
          flexWrap: 'wrap',
        }}
      >
        <span style={label}>COMPARE WITH</span>
        <Select
          value={selectedId ?? ''}
          onChange={e => onSelect(e.target.value || null)}
          style={{ minWidth: 280 }}
        >
          <option value="">
            {candidates.length === 0 ? 'No other analysed lift for this athlete' : 'Pick a lift…'}
          </option>
          {candidates.map(c => (
            <option key={c.analysis.id} value={c.analysis.id}>
              {[
                c.clip.date ? formatDateShort(c.clip.date) : '—',
                c.clip.exerciseName ?? 'Clip',
                c.clip.loadKg !== null ? `${num(c.clip.loadKg, 0)} kg` : null,
                c.analysis.rep_index > 1 ? `rep ${c.analysis.rep_index}` : null,
                c.isReference ? '★ reference' : null,
                // A model lift is somebody else's, so it says whose and what
                // it is a model of — comparing against an unnamed stranger's
                // bar path teaches nothing.
                c.isModel ? `🎓 ${c.modelLabel ?? c.clip.athleteName ?? 'model'}` : null,
                c.sameExercise ? null : '(different exercise)',
              ]
                .filter(Boolean)
                .join(' · ')}
            </option>
          ))}
        </Select>

        <span style={label}>ALIGNED ON</span>
        <Select
          value={anchor}
          onChange={e => onAnchor(e.target.value as AlignmentAnchor)}
          title={ALIGNMENT_WHY[anchor]}
          style={{ minWidth: 200 }}
        >
          {(Object.keys(ALIGNMENT_LABEL) as AlignmentAnchor[]).map(key => (
            <option key={key} value={key} title={ALIGNMENT_WHY[key]}>
              {ALIGNMENT_LABEL[key]}
            </option>
          ))}
        </Select>

        {subject && (
          <Segmented
            options={(Object.keys(MODE_LABEL) as ComparisonMode[]).map(key => ({
              value: key,
              label: MODE_LABEL[key],
              title:
                key === 'curves'
                  ? 'Bar paths, velocity curves and the delta table.'
                  : 'Both clips playing off one clock, synced on the alignment above.',
            }))}
            value={mode}
            onChange={setMode}
          />
        )}

        {referenceAligned && !referenceAligned.anchored && (
          <span style={{ ...caption, color: 'var(--color-warning-text)' }}>
            That lift has no detected {ALIGNMENT_LABEL[anchor].toLowerCase()} — aligned on the clip
            start instead.
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          title="Back to the lift"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 28,
            padding: '0 10px',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-primary)',
            fontSize: 'var(--text-caption)',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <X size={13} /> Back to the lift
        </button>
      </div>

      {loading && (
        <div style={{ display: 'grid', placeItems: 'center', flexGrow: 1 }}>
          <Spinner />
        </div>
      )}

      {!loading && !subject && (
        <div style={{ padding: 'var(--space-xl)', maxWidth: 560 }}>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--text-label)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.5,
            }}
          >
            {candidates.length === 0
              ? 'Nothing to compare against yet. A lift becomes comparable once it has a calibrated, marked track — analyse another clip of this athlete and it will appear here.'
              : 'Pick a lift above. Comparison needs both to be calibrated and marked; anything that is not will not appear in the list.'}
          </p>
        </div>
      )}

      {!loading && subject && referenceAligned && mode === 'video' && (
        <SideBySide
          current={current}
          currentAligned={currentAligned}
          subject={subject}
          referenceAligned={referenceAligned}
          referenceLabel={referenceLabel}
          playback={playback}
          follower={follower}
          alignedT={alignedT}
        />
      )}

      {!loading && subject && referenceAligned && mode === 'curves' && (
        <div
          style={{
            flexGrow: 1,
            minHeight: 0,
            display: 'flex',
            gap: 'var(--space-md)',
            padding: 'var(--space-md)',
          }}
        >
          {/* Bar paths — the thing a coach reads first, so the largest. */}
          <section style={{ ...card, flex: '0 0 42%', display: 'flex', flexDirection: 'column' }}>
            <header style={cardHeader}>
              <span style={label}>BAR PATH</span>
              <Legend currentLabel={current.label} referenceLabel={referenceLabel} />
            </header>
            <PathOverlay current={currentAligned} reference={referenceAligned} hoverT={hoverT} />
          </section>

          <div
            style={{
              flexGrow: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-md)',
            }}
          >
            <section style={{ ...card, flex: '0 0 44%', display: 'flex', flexDirection: 'column' }}>
              <header style={cardHeader}>
                <span style={label}>VERTICAL VELOCITY</span>
                {/* While the pointer is over the chart the header carries the
                    reading, so nothing is drawn on top of the curves. */}
                {hoverT === null ? (
                  <span style={caption}>{`t = 0 at ${ALIGNMENT_LABEL[anchor].toLowerCase()}`}</span>
                ) : (
                  <HoverReadout
                    t={hoverT}
                    current={currentAligned}
                    reference={referenceAligned}
                    currentLabel={current.label}
                    referenceLabel={referenceLabel}
                  />
                )}
              </header>
              <VelocityOverlay
                current={currentAligned}
                reference={referenceAligned}
                hoverT={hoverT}
                onHover={setHoverT}
              />
            </section>

            <section style={{ ...card, flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
              <header style={cardHeader}>
                <span style={label}>DIFFERENCES</span>
                <span style={caption}>{`this lift, against ${referenceLabel}`}</span>
              </header>
              <DeltaTable deltas={deltas} />
              {caveats.length > 0 && (
                <ul
                  style={{
                    margin: 'var(--space-sm) 0 0',
                    paddingLeft: 16,
                    display: 'grid',
                    gap: 3,
                  }}
                >
                  {caveats.map(text => (
                    <li
                      key={text}
                      style={{ ...caption, lineHeight: 1.4, color: 'var(--color-warning-text)' }}
                    >
                      {text}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Two clips off one clock.
 *
 * Design §8's first comparison item is "overlay two paths / side-by-side synced
 * playback"; this is its second half. What makes it a comparison rather than
 * two videos is the sync: the leader's playhead is converted to the aligned
 * clock and back into the reference's clip, so at every position both clips are
 * at the same MOMENT OF THE LIFT rather than the same second of footage.
 *
 * The transport drives the leader only. Stepping is on the leader's frame grid
 * — a coach steps through one lift and watches the other keep up — and the
 * follower lands on its nearest frame, which for two clips of different frame
 * rates is the only correct answer. How near is stated on screen: a mismatch of
 * a full frame at 30 fps is 33 ms of lift, and a coach comparing turnovers
 * deserves to know it is there.
 */
function SideBySide({
  current,
  currentAligned,
  subject,
  referenceAligned,
  referenceLabel,
  playback,
  follower,
  alignedT,
}: {
  current: ComparisonSide;
  currentAligned: AlignedSeries;
  subject: ComparisonSubject;
  referenceAligned: AlignedSeries;
  referenceLabel: string;
  playback: UseFrameServer;
  follower: UseFollowerFrame;
  alignedT: number | null;
}) {
  const leaderT = playback.server?.timestamps[playback.index] ?? null;
  const requestedT = alignedT === null ? null : alignedT + referenceAligned.anchorT;
  const sync = syncNote(requestedT, follower);

  const velocityAt = (aligned: AlignedSeries, t: number | null) =>
    t === null ? null : valueNear(aligned.t, aligned.vyMs, t);

  return (
    <div
      style={{
        flexGrow: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
        padding: 'var(--space-md)',
      }}
    >
      <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 'var(--space-sm)' }}>
        <ClipStage
          canvas={follower.frame?.canvas ?? null}
          width={follower.server?.displayWidth ?? 16}
          height={follower.server?.displayHeight ?? 9}
          points={subject.points}
          currentT={follower.shownT}
          color={REFERENCE_COLOR}
          overlay={
            follower.status === 'ready' && !follower.decodeError ? null : (
              <span>
                {follower.status === 'error'
                  ? follower.error
                  : follower.decodeError
                    ? follower.decodeError
                    : subject.clip.isEmbed
                      ? 'That clip is hosted as an embed, which cannot be decoded frame by frame. Its numbers still compare; its video cannot be played beside this one.'
                      : 'Opening the other clip…'}
              </span>
            )
          }
          footer={
            <>
              <span style={{ opacity: 0.75 }}>{referenceLabel}</span>
              <span style={{ marginLeft: 'auto' }}>
                {follower.shownT === null ? '—' : clipTime(follower.shownT)}
              </span>
              <Reading value={velocityAt(referenceAligned, alignedT)} />
              {/* Named, because a silent 30 ms is exactly the error a coach
                  would otherwise read as a difference between the lifts. */}
              {sync && (
                <span style={{ opacity: 0.7 }} title={sync.why}>
                  {sync.text}
                </span>
              )}
            </>
          }
        />
        <ClipStage
          canvas={playback.frame?.canvas ?? null}
          width={playback.server?.displayWidth ?? 16}
          height={playback.server?.displayHeight ?? 9}
          points={current.points}
          currentT={leaderT}
          color={CURRENT_COLOR}
          overlay={
            playback.status === 'ready' && !playback.decodeError ? null : (
              <span>{playback.decodeError ?? 'Opening this clip…'}</span>
            )
          }
          footer={
            <>
              <span style={{ fontWeight: 600 }}>{current.label}</span>
              <span style={{ marginLeft: 'auto' }}>
                {leaderT === null ? '—' : clipTime(leaderT)}
              </span>
              <Reading value={velocityAt(currentAligned, alignedT)} />
            </>
          }
        />
      </div>

      {playback.server && (
        <ViewerTransport
          index={playback.index}
          frameCount={playback.server.frameCount}
          timestamps={playback.server.timestamps}
          playing={playback.playing}
          speed={playback.speed}
          markedTimes={current.points.map(p => p.t)}
          fps={playback.server.averageFps}
          vfr={playback.server.isVfr}
          onSeek={playback.seek}
          onStep={playback.step}
          onTogglePlay={playback.togglePlay}
          onSpeed={playback.setSpeed}
        />
      )}
    </div>
  );
}

/**
 * How well the follower actually landed on the moment it was asked for, when
 * that is worth saying.
 *
 * Two very different situations produce the same arithmetic, and conflating
 * them is how a coach ends up reading a fixture artefact as a difference
 * between two lifts:
 *
 *   - **A few tens of milliseconds** is the two clips' frame rates disagreeing.
 *     There is no frame exactly at the synced moment, so the nearest one shows.
 *     Unavoidable, and worth naming — a frame at 30 fps is 33 ms of lift.
 *   - **A large offset at either end** is the reference clip simply not having
 *     footage that early or that late. The frame on screen is then not a near
 *     miss, it is the first or last frame standing in for one that does not
 *     exist, and saying "+350 ms off" implies a precision problem where there
 *     is a coverage one.
 */
function syncNote(
  requestedT: number | null,
  follower: UseFollowerFrame,
): { text: string; why: string } | null {
  if (requestedT === null || follower.shownT === null || !follower.server) return null;
  const timestamps = follower.server.timestamps;
  const first = timestamps[0] ?? 0;
  const last = timestamps[timestamps.length - 1] ?? 0;

  if (requestedT < first - 1e-6) {
    return {
      text: 'before this clip starts',
      why: 'The other lift is further along than anything this clip filmed. Its first frame is showing.',
    };
  }
  if (requestedT > last + 1e-6) {
    return {
      text: 'after this clip ends',
      why: 'This clip finished before the moment shown beside it. Its last frame is showing.',
    };
  }

  const slipMs = (follower.shownT - requestedT) * 1000;
  if (Math.abs(slipMs) < 1) return null;
  return {
    text: `${slipMs > 0 ? '+' : ''}${num(slipMs, 0)} ms off`,
    why: 'These clips have different frame rates, so the nearest frame to the synced moment is this far from it.',
  };
}

/** One velocity, in the tone the stage footers use. */
function Reading({ value }: { value: number | null }) {
  return <span style={{ fontWeight: 600 }}>{value === null ? '—' : `${num(value, 2)} m/s`}</span>;
}

function Legend({
  currentLabel,
  referenceLabel,
}: {
  currentLabel: string;
  referenceLabel: string;
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--space-md)' }}>
      <Key color={CURRENT_COLOR} text={currentLabel} />
      <Key color={REFERENCE_COLOR} text={referenceLabel} dashed />
    </span>
  );
}

function Key({ color, text, dashed }: { color: string; text: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...caption }}>
      <span
        style={{ width: 14, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }}
      />
      {text}
    </span>
  );
}

/** Horizontal exaggerations offered. ×1 is the truth and stays the default. */
const EXAGGERATIONS = [1, 2, 4] as const;
/** Candidate scale-bar lengths in cm; the largest that fits the box is used. */
const SCALE_STEPS = [1, 2, 5, 10, 20, 50];

/**
 * Two bar paths in one panel.
 *
 * A pull is around a metre tall and its loop a few centimetres wide, so at
 * equal aspect — which is the honest default and what the panel opens on — the
 * shape being compared is a thin ribbon down the middle of an empty box. Every
 * bar-path tool a coach has used solves this by stretching the horizontal, and
 * the stretch is exactly the lie this panel's comment used to warn about.
 *
 * So the stretch is offered, never assumed, and made impossible to misread:
 * the factor is a stated control rather than an auto-fit, and the L-shaped
 * scale bar in the corner has equal arms in centimetres — at ×1 it is a square
 * corner, at ×4 it is visibly four times wider than it is tall. The reader can
 * see the distortion in the drawing, not only in a caption they might skip.
 */
function PathOverlay({
  current,
  reference,
  hoverT,
}: {
  current: AlignedSeries;
  reference: AlignedSeries;
  hoverT: number | null;
}) {
  const [exaggeration, setExaggeration] = useState<number>(1);

  const ys = [...current.yCm, ...reference.yCm];
  const xs = [...current.xCm, ...reference.xCm].map(x => x * exaggeration);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 6;

  const boxW = maxX - minX + pad * 2;
  const boxH = maxY - minY + pad * 2;
  const top = -(maxY + pad);
  const bottom = -(minY - pad);
  const left = minX - pad;

  // SVG y grows downward and the bar goes up, so the box is flipped.
  const viewBox = `${left} ${top} ${boxW} ${boxH}`;
  const path = (s: AlignedSeries) =>
    s.xCm
      .map(
        (x, i) =>
          `${i === 0 ? 'M' : 'L'}${(x * exaggeration).toFixed(2)} ${(-s.yCm[i]).toFixed(2)}`,
      )
      .join(' ');

  // The longest round number whose arms both fit inside the box.
  const scaleCm =
    [...SCALE_STEPS].reverse().find(cm => cm * exaggeration <= boxW * 0.5 && cm <= boxH * 0.35) ??
    SCALE_STEPS[0];
  const inset = 3;
  const cornerX = left + inset;
  const cornerY = bottom - inset;

  // `meet` fits the box inside the element and scales both axes together, so
  // the rendered scale is whichever axis runs out first. Marker sizes are the
  // one thing here that belongs in screen pixels rather than centimetres.
  const [svgRef, svgSize] = useElementSize<SVGSVGElement>();
  const pxPerCm =
    svgSize.width > 0 && svgSize.height > 0
      ? Math.min(svgSize.width / boxW, svgSize.height / boxH)
      : 0;
  const cmPerPx = pxPerCm > 0 ? 1 / pxPerCm : 0;

  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ flexGrow: 1, minHeight: 0, width: '100%' }}
      >
        {/* The vertical through the start, so a loop is measured against
            something rather than eyeballed. */}
        <line
          x1={0}
          y1={top}
          x2={0}
          y2={bottom}
          stroke="var(--color-border-secondary)"
          strokeWidth={1}
          strokeDasharray="4 5"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path(reference)}
          fill="none"
          stroke={REFERENCE_COLOR}
          strokeWidth={2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path(current)}
          fill="none"
          stroke={CURRENT_COLOR}
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
        {/* Where each bar was at the moment under the pointer. Two dots on two
            paths answer "where were they when they diverged" without the coach
            having to hold one panel in their head while reading the other. */}
        {hoverT !== null &&
          [
            { s: reference, color: REFERENCE_COLOR, r: 3.5 },
            { s: current, color: CURRENT_COLOR, r: 4 },
          ].map(({ s, color, r }, i) => {
            const j = indexNear(s.t, hoverT);
            if (j === null) return null;
            return (
              <circle
                key={i}
                cx={s.xCm[j] * exaggeration}
                cy={-s.yCm[j]}
                // Radii are given in screen pixels and converted, because a
                // radius in centimetres would grow and shrink with the pull.
                r={r * cmPerPx}
                fill={color}
              />
            );
          })}
        {/* Equal arms in centimetres: the shape of this corner IS the factor. */}
        <path
          d={`M${(cornerX + scaleCm * exaggeration).toFixed(2)} ${cornerY.toFixed(2)} L${cornerX.toFixed(2)} ${cornerY.toFixed(2)} L${cornerX.toFixed(2)} ${(cornerY - scaleCm).toFixed(2)}`}
          fill="none"
          stroke="var(--color-text-tertiary)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          paddingTop: 'var(--space-xs)',
          flexWrap: 'wrap',
        }}
      >
        <span style={caption}>{`corner = ${num(scaleCm, 0)} × ${num(scaleCm, 0)} cm`}</span>
        <span style={{ ...label, marginLeft: 'auto' }}>HORIZONTAL</span>
        <Segmented
          value={exaggeration}
          onChange={setExaggeration}
          options={EXAGGERATIONS.map(factor => ({
            value: factor,
            label: `×${factor}`,
            title:
              factor === 1
                ? 'True proportions. A centimetre across is a centimetre up.'
                : `Horizontal stretched ${factor}×, so the loop is readable. Vertical is unchanged; the corner scale bar shows the distortion.`,
          }))}
        />
      </div>
    </div>
  );
}

/**
 * Both velocity curves on the aligned clock.
 *
 * The chart is stretched to its box (`preserveAspectRatio="none"`), which is
 * right for a curve and fatal for text — glyphs would stretch with it. So every
 * label here is HTML positioned over the SVG in percentages, and the SVG holds
 * only geometry.
 */
function VelocityOverlay({
  current,
  reference,
  hoverT,
  onHover,
}: {
  current: AlignedSeries;
  reference: AlignedSeries;
  hoverT: number | null;
  onHover: (t: number | null) => void;
}) {
  const W = 1000;
  const H = 200;
  const minT = Math.min(current.t[0] ?? 0, reference.t[0] ?? 0);
  const maxT = Math.max(
    current.t[current.t.length - 1] ?? 1,
    reference.t[reference.t.length - 1] ?? 1,
  );
  const vs = [...current.vyMs, ...reference.vyMs];
  const minV = Math.min(...vs);
  const maxV = Math.max(...vs);
  const spanT = maxT - minT || 1;
  const spanV = maxV - minV || 1;

  const path = (s: AlignedSeries) =>
    s.t
      .map(
        (t, i) =>
          `${i === 0 ? 'M' : 'L'}${(((t - minT) / spanT) * W).toFixed(2)} ${(
            H -
            ((s.vyMs[i] - minV) / spanV) * H
          ).toFixed(2)}`,
      )
      .join(' ');

  const zeroY = H - ((0 - minV) / spanV) * H;
  const anchorX = ((0 - minT) / spanT) * W;
  const fractionOf = (t: number) => (t - minT) / spanT;

  // Seconds either side of the anchor, at a step that gives a readable number
  // of ticks whatever the two clips are worth of time.
  const step = TIME_STEPS.find(s => spanT / s <= 12) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(minT / step) * step; t <= maxT + 1e-9; t += step) {
    ticks.push(Math.abs(t) < 1e-9 ? 0 : t);
  }

  const trackRef = useRef<HTMLDivElement | null>(null);
  const readPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onHover(minT + fraction * spanT);
  };

  return (
    <div
      ref={trackRef}
      onPointerMove={e => readPointer(e.clientX)}
      onPointerLeave={() => onHover(null)}
      style={{
        position: 'relative',
        flexGrow: 1,
        minHeight: 0,
        display: 'flex',
        cursor: 'crosshair',
        touchAction: 'none',
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ flexGrow: 1, minHeight: 0, width: '100%' }}
      >
        {ticks.map(t => (
          <line
            key={t}
            x1={fractionOf(t) * W}
            y1={0}
            x2={fractionOf(t) * W}
            y2={H}
            stroke="var(--color-border-tertiary)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {zeroY >= 0 && zeroY <= H && (
          <line
            x1={0}
            y1={zeroY}
            x2={W}
            y2={zeroY}
            stroke="var(--color-border-tertiary)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <line
          x1={anchorX}
          y1={0}
          x2={anchorX}
          y2={H}
          stroke="var(--color-border-secondary)"
          strokeWidth={1}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path(reference)}
          fill="none"
          stroke={REFERENCE_COLOR}
          strokeWidth={2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path(current)}
          fill="none"
          stroke={CURRENT_COLOR}
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
        {hoverT !== null && (
          <line
            x1={fractionOf(hoverT) * W}
            y1={0}
            x2={fractionOf(hoverT) * W}
            y2={H}
            stroke="var(--color-text-primary)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Labels live in HTML because the SVG is stretched to its box. */}
      <AxisLabel style={{ left: 4, top: 2 }}>{`${num(maxV, 2)} m/s`}</AxisLabel>
      <AxisLabel style={{ left: 4, bottom: 2 }}>{`${num(minV, 2)} m/s`}</AxisLabel>
      {ticks.map(t => (
        <AxisLabel
          key={t}
          style={{
            left: `${fractionOf(t) * 100}%`,
            bottom: 2,
            transform: 'translateX(-50%)',
            fontWeight: t === 0 ? 600 : 400,
          }}
        >
          {/* The unit rides on the last tick — naming it once is enough, and
              repeating "s" nine times across an axis is noise. */}
          {`${t === 0 ? '0' : `${t > 0 ? '+' : ''}${num(t, step < 1 ? 1 : 0)}`}${
            t === ticks[ticks.length - 1] ? ' s' : ''
          }`}
        </AxisLabel>
      ))}
    </div>
  );
}

/** Tick spacings in seconds, coarsest last. */
const TIME_STEPS = [0.1, 0.2, 0.5, 1, 2, 5];

/** A joined row of exclusive choices. Two or three short options that belong
 *  together read better joined than as separate buttons or a select. */
function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; title?: string }>;
}) {
  return (
    <span style={{ display: 'inline-flex' }}>
      {options.map((option, i) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          title={option.title}
          aria-pressed={value === option.value}
          style={{
            height: 22,
            padding: '0 8px',
            border: '1px solid var(--color-border-secondary)',
            borderLeftWidth: i === 0 ? 1 : 0,
            borderTopLeftRadius: i === 0 ? 'var(--radius-sm)' : 0,
            borderBottomLeftRadius: i === 0 ? 'var(--radius-sm)' : 0,
            borderTopRightRadius: i === options.length - 1 ? 'var(--radius-sm)' : 0,
            borderBottomRightRadius: i === options.length - 1 ? 'var(--radius-sm)' : 0,
            background: value === option.value ? 'var(--color-accent)' : 'var(--color-bg-primary)',
            color:
              value === option.value
                ? 'var(--color-text-on-accent)'
                : 'var(--color-text-secondary)',
            fontSize: 'var(--text-micro)',
            fontFamily: 'inherit',
            fontVariantNumeric: 'tabular-nums',
            cursor: 'pointer',
          }}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

function AxisLabel({ children, style }: { children: ReactNode; style: CSSProperties }) {
  return (
    <span
      style={{
        position: 'absolute',
        fontSize: 'var(--text-micro)',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--color-text-tertiary)',
        pointerEvents: 'none',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * The reading at the moment under the pointer: both velocities and the gap
 * between them. The delta table says which lift was faster overall; this says
 * where the difference was made, which is the next question and the one a table
 * cannot answer.
 */
function HoverReadout({
  t,
  current,
  reference,
  currentLabel,
  referenceLabel,
}: {
  t: number;
  current: AlignedSeries;
  reference: AlignedSeries;
  currentLabel: string;
  referenceLabel: string;
}) {
  const a = valueNear(reference.t, reference.vyMs, t);
  const b = valueNear(current.t, current.vyMs, t);
  const gap = a !== null && b !== null ? b - a : null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 'var(--space-sm)',
        fontSize: 'var(--text-caption)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span style={{ color: 'var(--color-text-tertiary)' }}>{`t ${t >= 0 ? '+' : ''}${num(
        t,
        2,
      )} s`}</span>
      <span style={{ color: REFERENCE_COLOR }} title={referenceLabel}>
        {a === null ? '—' : num(a, 2)}
      </span>
      <span style={{ color: CURRENT_COLOR, fontWeight: 600 }} title={currentLabel}>
        {b === null ? '—' : num(b, 2)}
      </span>
      <span style={{ color: 'var(--color-text-secondary)' }}>
        {gap === null ? '' : `${gap > 0 ? '+' : ''}${num(gap, 2)} m/s`}
      </span>
    </span>
  );
}

/** Index of the sample nearest a time, or null when it is outside the clip. */
function indexNear(t: readonly number[], at: number): number | null {
  if (t.length === 0 || at < t[0] || at > t[t.length - 1]) return null;
  let best = 0;
  for (let i = 1; i < t.length; i++) {
    if (Math.abs(t[i] - at) < Math.abs(t[best] - at)) best = i;
  }
  return best;
}

function valueNear(t: readonly number[], values: readonly number[], at: number): number | null {
  const i = indexNear(t, at);
  return i === null ? null : values[i];
}

/**
 * The rendered size of an element. Needed wherever a length has to be given in
 * screen pixels inside a scaled viewBox — there is no CSS or SVG way to ask for
 * that without measuring.
 */
function useElementSize<T extends Element>(): [
  (node: T | null) => void,
  { width: number; height: number },
] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });

    // Not in jsdom, and not worth a polyfill — the first measurement above is
    // enough for a test environment that never resizes.
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: box.width, height: box.height });
    });
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, size];
}

function DeltaTable({ deltas }: { deltas: MetricDelta[] }) {
  return (
    <table
      style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}
    >
      <thead>
        <tr>
          <Th align="left">Metric</Th>
          <Th>Reference</Th>
          <Th>This lift</Th>
          <Th>Change</Th>
          <Th align="left" />
        </tr>
      </thead>
      <tbody>
        {deltas.map(row => (
          <tr key={row.id} title={row.why}>
            <Td align="left" muted>
              {row.label}
            </Td>
            <Td>{row.a === null ? '—' : num(row.a, row.decimals)}</Td>
            <Td>{row.b === null ? '—' : num(row.b, row.decimals)}</Td>
            <Td>
              {row.delta === null
                ? '—'
                : `${row.delta > 0 ? '+' : ''}${num(row.delta, row.decimals)} ${row.unit}`}
            </Td>
            <Td align="left">
              {/* The word, not only the colour. Which way is up differs row by
                  row, and on some rows there is no up. */}
              <span
                style={{
                  fontSize: 'var(--text-micro)',
                  fontWeight: 600,
                  color: verdictTone(row.verdict),
                }}
              >
                {verdictWord(row.verdict)}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function verdictWord(verdict: MetricDelta['verdict']): string {
  if (verdict === 'better') return 'better';
  if (verdict === 'worse') return 'worse';
  if (verdict === 'same') return 'no change';
  if (verdict === 'different') return 'different';
  if (verdict === 'incomparable') return 'not comparable';
  return '';
}

function verdictTone(verdict: MetricDelta['verdict']): string {
  if (verdict === 'better') return 'var(--color-success-text)';
  if (verdict === 'worse') return 'var(--color-danger-text)';
  if (verdict === 'incomparable') return 'var(--color-warning-text)';
  return 'var(--color-text-tertiary)';
}

function Th({ children, align = 'right' }: { children?: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '2px 6px 4px 0',
        fontSize: 'var(--text-micro)',
        fontWeight: 500,
        letterSpacing: '0.04em',
        color: 'var(--color-text-tertiary)',
        borderBottom: '1px solid var(--color-border-tertiary)',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'right',
  muted,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  muted?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '3px 6px 3px 0',
        fontSize: 'var(--text-label)',
        color: muted ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
      }}
    >
      {children}
    </td>
  );
}

const card: CSSProperties = {
  background: 'var(--color-bg-primary)',
  border: '1px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-md)',
};

const cardHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-sm)',
  marginBottom: 'var(--space-sm)',
  flexWrap: 'wrap',
};

const label: CSSProperties = {
  fontSize: 'var(--text-caption)',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
};

const caption: CSSProperties = {
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-tertiary)',
};
