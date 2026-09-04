# KinEMOS P2 — Assisted tracking & metrics (build plan)

**Parent:** `docs/KINEMOS_DESIGN.md` §12 (P2). **Predecessors:**
`docs/KINEMOS_P0_PLAN.md` (library, 0.78.x), `docs/KINEMOS_P1_PLAN.md`
(study room, 0.79.x).

> **Status: SHIPPED.** P2a (the measurement pipeline and its surfaces) in
> 0.80.0; P2b (the assisted tracker) in 0.81.0.

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

## 4. What P2b shipped

**Pure TypeScript, no OpenCV.** The design doc's implementation note assumed
opencv.js, hand-rolling from `matchTemplate` + `calcOpticalFlowPyrLK` because
CSRT/KCF live in opencv_contrib. The dependency turned out to be unnecessary:
for one large, high-contrast disc anchored by the coach, normalised
cross-correlation over a masked template is a few hundred lines and no 9 MB WASM
payload. The engine boundary means it can still be swapped if real footage
demands it.

**Anchor and supervise.** The coach marks the bar end on any frame; the tracker
fills the clip forwards and backwards from it. Per-frame confidence paints the
scrub strip, so the frames worth checking are visible without scrubbing all 218
— the design brief's third open question, answered properly this time. A
correction is the same gesture (mark the wrong frame, track again), which is why
re-tracking needed no separate code path, and it increments `correction_count`,
which the grade reads to demote a tracker that is not really doing the work.

### Two assumptions the measurements overturned

**The annulus mask was wrong.** The design doc reasoned that plates spin, so the
template must exclude the rotating face and match only the rim. Measured against
a synthetic plate carrying realistic branding through a full rotation, position
error by inner radius:

| inner / outer | 0,00 | 0,30 | 0,45 | 0,60 | 0,70 | 0,78 |
| --- | --- | --- | --- | --- | --- | --- |
| RMS error (px) | 0,038 | 0,047 | 0,050 | 0,065 | 0,089 | 0,243 |

A ring does hold slightly higher correlation through the spin — but correlation
only has to clear the confidence threshold, while position error *is* the
product. Cutting the middle out throws away most of the pixels that localise the
disc. The circular edge dominates the correlation regardless of what is printed
inside it, so the default masks nothing and the knob stays for footage that
misbehaves.

**The template was cut on the wrong pixel.** A template can only be cut on whole
pixels, but the coach clicks at (120,37 · 170,61) — so every match inherited that
fractional offset, identically, on every frame. A systematic half-pixel error,
invisible to anyone watching the overlay. Ground-truth testing found it in one
run: RMS went from 0,53 px to 0,04 px.

### Measured

| | RMS | worst | min confidence |
| --- | --- | --- | --- |
| Synthetic images (`tracker.test.ts`) | 0,04 px | — | 0,79 through a full rotation |
| Through VP9 encode → frame server → canvas (`verify/tracker.html`) | 0,09 px | 0,16 px | 0,76 |

At ~20 ms per frame including decode, a 200-frame clip tracks in about four
seconds.

**What the grade does with that: nothing yet.**
`TIER_POSITION_NOISE_PX.assisted` stays at a conservative 0,8 px rather than the
0,09 that was measured. Neither measurement includes motion blur through the
second pull, a lifter's hands crossing the plate, a camera that moves, or a
plate half out of frame. Carrying 0,09 into the grade would put every clip at A,
which is exactly the over-claim the grade exists to prevent. The figure moves
when somebody measures a real clip against a hand-labelled track.

### Real footage: the testset (04/09/2026)

Seven phone and camera clips — 1080p landscape and portrait, HEVC 60 fps, a
1080 × 1440, a 1200 × 2136, an 8K 24 fps — run through the real frame server,
the real adapter and the real engine via `verify/testset.html` (below). What the
synthetic measurements had not covered, and what changed:

**The anchor template alone dies mid-pull.** On every clip the anchor patch's
correlation decayed steadily as the bar rose — 0,98 → 0,31 on a red ZKC 25,
0,90 → 0,48 on a black Eleiko — with the track still on the hub, until the
0,55 threshold declared the bar lost eight frames later. Always at peak
velocity, the one number the coach wanted. Scored at the tracked position
against the anchor patch rotated (36 angles), rescaled (0,85–1,15) and
motion-blurred along the track, none of the variants recovered the score: the
plate's look changes cumulatively (a camera two metres away sees the face at a
different angle at 1,6 m than at 0,2 m), and a rotation-averaged template
correlated at ~0,3 even when perfectly placed. The remedy is a second, *current*
template blended toward the latest confident match (rate 0,5, only from a
match ≥ 0,6 that has drifted under 0,9) while the coach's anchor is kept and
re-scored at every peak, winning ties — so drift resets whenever the plate looks
as it did when clicked. Measured on a synthetic morph calibrated to the real
decay (anchor correlation → 0,43): 0,23 px worst error, 0,08 px RMS once the
anchor has snapped the track back.

| clip | before | after |
| --- | --- | --- |
| Snatch, HEVC 60 fps portrait | lost at frame 126 of 561 | 561/561, min confidence 0,77 |
| Pull, HEVC 60 fps portrait, close camera | lost at frame 189 of 532 | 532/532, min 0,59, grade A |
| Competition snatch, H.264 30 fps | 284/314 (dropped bar) | 314/314, min 0,76 |
| Snatch, HEVC 30 fps 1080 × 1440 | — | 431/457, stops cleanly where the bar is dropped |
| Training hall, H.264 30 fps portrait, 18 s | — | 535/545, min 0,59; ends where the camera pans away |

(The 1200 × 2136 clip could not be verified: without the viewer to place the
anchor, the numeric plate finder used for the bench landed on a racked plate,
which tracked at 0,97 for 658 frames and, correctly, never moved.)

**A plate leaving the frame ran the track away.** With every template pixel
required inside the frame, the first partly-visible frame scored −1 on every
candidate, the "best" of those was recorded as a point, and the constant-
velocity prediction compounded it: eight frames later the track was 557 px off
the bottom of the picture and the analysis reported a 15 m/s peak at grade A.
Now a candidate is scored on the visible part of the template (both halves
re-centred on that subset, down to half the plate), and a frame whose best score
is under 0,3 yields no point at all — listed as uncertain, prediction carried on
from the last real match, counted toward giving up.

**The search radius was a pixel count.** Fourteen pixels covers the
acceleration term of a constant-velocity guess at 60 fps and 1080p; on the 8K
24 fps clip the same term is 93 px, and the first step out of a mid-lift anchor
(no velocity yet) needs the whole per-frame travel. `searchRadiusFor` derives
both from the plate's on-screen size and the frame interval, with the option as
a floor.

**Frame supply, not correlation, is the cost.** Reading back a full
1080 × 1920 frame cost ~170 ms — more than decoding it — while the tracker
looks at ~2 % of it. The adapter now reads the region the tracker names
(`FrameSource.getGray(index, region)`), and decodes a backward walk in forward
runs so each keyframe seek pays for sixteen frames rather than one. Correlation
is 6–15 ms/frame; what remains is the frame server's own ~50–100 ms decode-to-
canvas, which a luma-plane region copy (`VideoFrame.copyTo` with a rect) would
cut further — not built.

**Phases read the clip, not the lift.** Lift-off was the first upward wiggle,
so a competition clip's five seconds of set-up (rolling the bar in, lifting it
a centimetre to set the back) declared lift-off at 0,0 s and a 5 s "transition";
the apex was the clip's highest point, so a clip that ran through the recovery
put the turnover at 1,7 s and the catch at zero. Lift-off is now the start of
the rise that ends at peak velocity (searched backward from the peak, with the
hold applied to the pause), and the apex is the first height maximum after the
peak. On the competition clip: lift-off 6,87 s, catch 7,90 s.

**The 8K clip.** Decodes (hardware HEVC, ~100–240 ms/frame served at
7680 × 4320) but a single decode failed mid-run and the frame server had no
retry; twenty-four cached frames would also have been 3,2 GB. The server now
retries a failed decode once and bounds the cache in bytes (384 MB: two frames
at 8K, twenty-four at 1080p).

### After the merge with the P3b–P5 line (0.90.0)

The cloud line had reworked the same two modules from the same 0.83.3 base
(P3 plan §8: a per-frame-travel search floor, a plausible-miss rule for
blurred pulls, colour re-acquisition, set tracking; an acceleration-based
transition and the analyzer measures in phases). Merged by measurement:

- The per-frame-travel floor (15·R/fps, 53 px on a 30 fps 1080p clip) cost
  71 ms of correlation per frame against 11 ms at 14 px, and with the current
  template following the blur the prediction error never exceeded 17 px on
  any testset clip. Dropped; `searchRadiusFor` keeps the acceleration term,
  with the bound raised to 45 m/s² to cover that 17 px.
- The plausible-miss patience stays for scores between 0,3 and the confidence
  threshold; under 0,3 there is no point at all.
- **Only the lift.** A plain TRACK now cuts the track to the rep the anchor
  sits in (`engine/reps.ts`, the set tracker's cut), led by up to 0,4 s of the
  rest before lift-off so the phase detector can see the bar start. The rep
  splitter gained a drop rule: a catch lowers the bar at under ~1,5 m/s, a
  bar let go passes 2 m/s within a fifth of a second, so the rep ends at the
  last sample before that. The testset's snatch double had its first rep
  "caught" 126 cm below the apex — on the floor — before this; after it the
  catch is 0,17 s and 19 cm.
- The acceleration-based transition fired at the lift-off transient on the
  close-camera pull (first pull and transition of zero length); a transition
  now needs the bar at least 15 cm above lift-off (`minTransitionRiseCm`).

Retest on the merged engine: competition snatch 314/314 (rep 6,87–8,17 s,
peak 1,92 m/s); snatch double 561/561 (two reps found, 1,22–2,36 s and
6,91–8,09 s); close-camera pull 532/532, grade A; 1080 × 1440 snatch as
before; training hall 533/545, no rep found (the bar is never lifted in the
tracked span — the fallback to the whole track is what remains to be said
honestly in the viewer).

## 5. The verification harnesses

Three, each closing a gap the layer above it cannot:

| Harness | What it proves | How |
| --- | --- | --- |
| `verify/frame-server.html` | Frame-accurate **seeking** — that frame *n* really is frame *n* | Encodes a clip whose every frame carries a grey patch naming its own index, reads it back through the real frame server, and recovers the index from the pixels |
| `verify/tracker.html` | The tracker through the **real** path — codec, frame server, canvas readback, greyscale conversion | Encodes a plate on a drawn trajectory and compares the track to it |
| `verify/viewer-preview.html` + `verify/drive-gestures.mjs` | The **pointer maths** — client coordinates through a scaled canvas, times through a band's width, a drag that survives pointer capture | Renders the analysis surfaces against a synthetic lift and drives them with a real browser pointer |

The first two run in any browser with no dependency. The gesture driver needs
`npm i --no-save playwright-core`, deliberately not a project dependency.

They exist because the layers they cover are exactly the ones jsdom cannot
reach: there is no decoder, and there is no layout, so every
`getBoundingClientRect()` in a unit test is zero. Between them they have caught
a frame server that threw on every clip, a tracker with a systematic half-pixel
offset, a phase whose duration was always zero, and a rail whose verdict sat
below the fold.

## 6. Out of scope for P2

Comparison, trend views, talkovers, sharing, overlay export — P3. Stabilisation
and the device-profile calibration tier are P3 as well; the columns and the
grade inputs for both already exist so neither needs a migration.
