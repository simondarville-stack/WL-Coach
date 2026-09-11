/**
 * StopTrackButton — the one Stop control for every track the viewer runs.
 *
 * Three surfaces show that a track is running (the rail's tracking block, the
 * "This lift" panel, and the "Tracking & correction" panel header when it is
 * collapsed), and each needs the control, because any one of them can be off
 * screen: the tracking panel is closed in the `look` and `read` depth presets
 * and unmounts its children when collapsed, and LiftPanel's busy area only
 * renders on a rep that has no metrics yet. One component so the label, the
 * icon and the colour cannot drift between them.
 *
 * **What Stop means here: nothing from the run is stored, and nothing is
 * applied to the screen.** The same meaning the library's sweep has. It is
 * not a preference — three things in the code make keeping a partial set
 * unsafe: `persistRep` upserts each rep in place with no undo (`deleteAnalysis`
 * has no caller), so a partial re-track leaves a clip whose reps came from two
 * runs with nothing to tell them apart; a rep whose calibration loop was cut
 * short keeps the set's calibration and is stored byte-identical to a properly
 * calibrated one (`ownCalibration` is only ever used to build a sentence);
 * and a truncated track can fabricate a rep, because `reps.ts` treats the last
 * sample as an apex (`i === limit`), which then leaves the catch equal to it.
 *
 * **Why `stopping` is a state and not a flicker.** The worst poll-to-poll gap
 * is `trackSet`'s reacquire-at-rest loop, which the file itself prices at
 * 0,7-1,5 s per iteration with `findPlate` at the clip's native resolution.
 * The press is acknowledged on the next paint; the pipeline catches up after.
 *
 * **Why `saving` exists.** Once `persistSetReps` starts writing, stopping
 * would produce exactly the half-set the rule refuses. It is four round trips
 * per rep, so the button says "Storing…" and disables rather than pretending.
 */
import { Loader2, Square } from 'lucide-react';
import { Button } from '../../components/ui';

export type TrackPhase = 'idle' | 'tracking' | 'stopping' | 'saving';

export function StopTrackButton({
  phase,
  onStop,
  iconOnly = false,
}: {
  phase: TrackPhase;
  onStop: () => void;
  iconOnly?: boolean;
}) {
  if (phase === 'idle') return null;

  const running = phase === 'tracking';
  const label = running ? 'Stop' : phase === 'stopping' ? 'Stopping…' : 'Storing…';
  const title = running
    ? 'Stop tracking. Nothing from this run will be stored.'
    : phase === 'stopping'
      ? 'Stopping — nothing from this run will be stored.'
      : 'Storing the reps found — this finishes.';

  return (
    <Button
      size="sm"
      // `danger` is the outline button (bg-primary, danger text, a 0,5 px
      // danger border) rather than a filled red block — right for a control
      // that lives beside a progress bar.
      variant="danger"
      iconOnly={iconOnly}
      icon={running ? <Square size={13} /> : <Loader2 size={13} className="animate-spin" />}
      disabled={!running}
      title={title}
      aria-label={iconOnly ? 'Stop tracking' : undefined}
      onClick={onStop}
    >
      {label}
    </Button>
  );
}
