# KinEMOS P2 — Assisted tracking & metrics (build plan)

**Parent:** `docs/KINEMOS_DESIGN.md` §12 (P2). **Predecessors:**
`docs/KINEMOS_P0_PLAN.md` (library, 0.78.x), `docs/KINEMOS_P1_PLAN.md`
(study room, 0.79.x).

> **Status: P2a SHIPPED in 0.80.0** — the measurement pipeline and the surfaces
> that show it. **P2b (the assisted tracker) is in progress.**

**P2 promise:** the numbers a coach came for — velocity per phase, power, a bar
path they did not have to place by hand — each carrying an honest statement of
how far to trust it.

---

## 1. Why the halves are in this order

The design doc lists P2 as one phase: tracker *and* metrics. Built in that
order, the first velocity a coach ever sees comes out of a tracker nobody has
validated, through a filter nobody has validated, and there is no way to tell
which one is lying.

So P2 is split, and the metrics come first:

- **P2a — the measurement pipeline**, driven by the tracks P1 already produces
  by hand. Independently valuable (a coach with a hand-marked track gets
  velocities today), pure maths that is fully testable without a browser, and
  it fills the rail P1 deliberately left empty.
- **P2b — the assisted tracker**, which replaces the hand as the *input* to a
  pipeline already known to be correct. When a number then looks wrong, there
  is exactly one new thing it can be.

## 2. P2a architecture decisions

1. **Filter position, then differentiate — never the reverse.** Smoothing a
   velocity curve smooths away the peak, which is the one number a coach quotes.
   The order is fixed in `engine/kinematics.ts` and stated in `engine/signal.ts`.

2. **Zero phase, and the cutoff the coach asked for.** A one-way IIR filter
   delays the signal by several frames; every phase boundary read off a velocity
   turning point then sits late, the numbers stay plausible, and the timing is
   wrong. Filtering forward and backward cancels it exactly — and doubles the
   effective order, which moves the −3 dB point unless Winter's correction is
   applied. Both are implemented and both are measured in the tests rather than
   asserted in a comment.

3. **A real Butterworth cascade.** Two 2nd-order Butterworths in series is a
   Linkwitz-Riley filter, −6 dB at the corner, and Winter's correction does not
   describe it. `butterworthQs` places poles properly; the test suite measures
   −3 dB at the requested cutoff for both orders, which is the assertion that
   fails if anyone "simplifies" this later.

4. **Padding scaled to the filter's memory, plus a least-squares detrend.**
   scipy's `3 · max(len(a), len(b))` is a coefficient count, and it is far too
   short: a 6 Hz Butterworth rings for about two cycles, which at 240 fps is
   eighty samples, not nine. Measured, that left a transient worth 7 % of
   gravity a fifth of a second into a clip. Detrending matters for the same
   reason: a bar track is a *rising* signal, so its ends — lift-off and the
   catch — are exactly where a start-up transient lands.
   `filterEdgeSeconds()` states what padding still cannot fix.

5. **No velocity without a calibration.** `computeKinematics` returns null
   rather than pixels per second. This is the P1 stance carried forward: a
   number whose unit is missing is worse than no number.

6. **Power is barbell power.** F = m(a + g) times vertical bar velocity, the
   convention in the weightlifting literature. It is not system power and
   cannot be, from one tracked bar end. Free flight tests it exactly: the
   answer is zero, and a sign error in the force model returns twice
   body-weight instead.

7. **The phase set is data, not an enum.** Coaches disagree about where the
   first pull ends and whether the transition is a phase at all. Each definition
   names the rule that proposes its start and carries that rule's thresholds, so
   a three-phase model works without the detector knowing about it — which the
   tests demonstrate with a set it has never seen. Every boundary is a
   *proposal*: drag one and it becomes `source: 'coach'` and nothing re-proposes
   over it.

8. **A signature that is not there is not invented.** A pull with no double
   knee bend gets its transition edges placed proportionally and marked
   `fallback`; the band draws them hatched and the legend flags them. The same
   applies to a clip cut at the apex, where there is no settle to find.

9. **The grade is an error budget, not a lookup table.** From central-difference
   noise and the filter's bandwidth:

   > **σ_v ≈ σ_pos · √(fps · fc)**

   It says something a coach can act on — filming closer beats everything else,
   and a higher frame rate makes velocity *noisier*, not cleaner, because
   shorter differentiation intervals amplify the same pixel noise. Nothing is
   fitted. The check that matters is that it reproduces the design doc's two
   promised tiers unprompted: a coach's click at 2 mm/px and 60 fps lands on
   0,057 m/s and a marker on 0,015 — the ±0,05 and ±0,02 of design §6.4.

10. **Hand-rolled SVG charts, not Recharts.** Recharts is in the stack and would
    be right for a dashboard, but it lives in a 344 kB chunk this route would
    then pull in, and none of its axis/legend/tooltip machinery is wanted: two
    polylines on an externally-controlled domain with a draggable overlay is
    fewer lines drawn than configured.

## 3. What P2a shipped

| Module | What it is |
| --- | --- |
| `engine/signal.ts` | Uniform resampling, zero-phase Butterworth with Winter correction, memory-scaled padding, least-squares detrend, central differences, `filterEdgeSeconds` |
| `engine/kinematics.ts` | The pipeline: calibrate → resample → filter → differentiate → power. Per-rep summary |
| `engine/phases.ts` | Parameterised phase registry, boundary proposal with detected/fallback provenance, per-phase and whole-lift metrics |
| `engine/grade.ts` | The error budget, the A/B/C letter, the conditions behind it, and what would move it |
| `components/AnalysisPanel.tsx` | Phase band with draggable edges + velocity/secondary curves on one shared x-axis |
| `components/MetricsPanel.tsx` | Velocity, loss, power, phase table, bar mass |
| `components/GradePanel.tsx` | Grade, conditions, and improvements |
| `verify/viewer-preview.tsx` | A design bench for all of the above, against a synthetic lift |
| migration `20260902090000` | `phase_boundaries`, `phase_set_id`, `metrics`, `grade*`, `camera` on `kinemos_analyses` |

### What the design bench caught

The viewer cannot be opened without a coaching environment and a real clip,
which made these panels the hardest part of the app to actually look at. Half an
hour with `verify/viewer-preview.html` found, in order:

- **The catch phase was always 0,00 s.** The settle rule fired on the apex,
  where velocity crosses zero by definition. Now the rule steps past the descent
  first — and says `fallback` when a clip ends before the bar comes to rest.
- **"Loss 1st → 2nd" printed "−0,05 m/s" for a pull that got FASTER** through
  the transition, i.e. the exact opposite of what happened.
- The engine was emitting US decimals into display strings (`2.0 mm/px`).
- The chart legend sat on top of the velocity curve, at its peak.
- Four stacked panels put the grade's own verdict below the fold in a 304 px
  rail; the conditions table now collapses.
- A hyphen and a typographic minus appeared side by side at 11 px.

None of these would have failed a unit test, and none would have survived a
coach's first session.

## 4. P2b — the assisted tracker (next)

- **Pure TypeScript, no OpenCV.** The design doc's implementation note assumed
  opencv.js and hand-rolling from `matchTemplate` + `calcOpticalFlowPyrLK`. The
  WASM build is ~9 MB and, for this target — one large, high-contrast,
  rotation-symmetric disc, anchored by the coach on frame 1 — pyramidal
  normalised cross-correlation with sub-pixel refinement is a few hundred lines
  and no dependency at all. Revisit if it proves inadequate; the engine boundary
  means swapping the implementation costs nothing above it.
- **Validated against ground truth.** The browser harness can synthesise a clip
  of a disc on a known trajectory, so tracker error is measurable in pixels
  rather than assessed by eye — and `TIER_POSITION_NOISE_PX.assisted` in the
  grade stops being a guess.
- **Anchor and supervise.** Coach clicks the bar end on frame 1; the tracker
  runs; per-frame confidence paints the timeline strip so the frames worth
  checking are visible without scrubbing all 218 (the design brief's third open
  question, answered properly this time). A correction re-tracks from that frame
  and increments `correction_count`, which the grade already reads.

## 5. Out of scope for P2

Comparison, trend views, talkovers, sharing, overlay export — P3. Stabilisation
and the device-profile calibration tier are P3 as well; the columns and the
grade inputs for both already exist so neither needs a migration.
