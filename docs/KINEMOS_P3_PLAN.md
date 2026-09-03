# KinEMOS P3 — Comparison & sharing (build plan)

**Parent:** `docs/KINEMOS_DESIGN.md` §12 (P3). **Predecessors:**
`docs/KINEMOS_P0_PLAN.md` (library, 0.78.x), `docs/KINEMOS_P1_PLAN.md`
(study room, 0.79.x), `docs/KINEMOS_P2_PLAN.md` (metrics 0.80.0, tracker
0.81.x).

> **Status: P3a SHIPPED** — the charts in 0.82.0, synced side-by-side playback
> in 0.83.0. **P3b SHIPPED** — metric trends in 0.84.0 (§5 below). **P3c
> SHIPPED** — the reference lift, same ship (§6). **P3d SHIPPED** — the
> OpenCV assists: find the plate, snap the outline, stabilise the camera,
> same ship (§7). The rest of P3 — talkover, sharing, overlay export, the
> device-profile calibration tier — is not started.

**P3 promise:** the coach's actual question. Not "what was the peak velocity"
— P2 answers that — but *"why did that one fail when the one last month made
it"*. That question needs two lifts on one screen.

---

## 1. Why comparison comes before sharing

Design §8 already ranks the comparison work: (1) overlay two paths /
side-by-side synced playback, (2) metric trends over time, (3) versus a model
lift. P3 also carries talkover, sharing and overlay export.

Comparison goes first, and the ordering is not just the design doc's:

- **It is the only P3 item that needs no new infrastructure.** Every input
  exists — P2 stores tracks, calibrations, phases and metrics per analysis.
  Comparison is a second read and a projection.
- **Trends need a metric registry decision** that is still open (design §13
  open question 3: merge KinEMOS metrics into the Analysis registry, or keep
  them adjacent). Building trend views before that decision means building
  them twice.
- **Sharing needs snapshots to be worth sharing.** A snapshot of one lift is
  a picture; a snapshot of two lifts overlaid is an argument. Comparison makes
  the sharing payload better, so it comes first.

## 2. P3a architecture decisions

1. **Two lifts are aligned on a shared physical event, not on frame zero.**
   One clip includes the walk-up, the other
   starts with the bar already loaded; overlaid from the first frame
   they compare the camera operators. `alignSeries` shifts both time *and*
   position so the anchor is the origin in both — position too, because two
   lifts filmed from different distances produce paths that are the same shape
   in different places, and it is the shape being compared.

2. **Lift-off is the default anchor**, exactly as design §8 suggests
   ("sync by phase marker, e.g. both at bar-off-floor"). It is the one event
   every pull has and it is where the bar path starts. Peak velocity, apex and
   raw clip-start are offered; each carries a sentence in `ALIGNMENT_WHY`
   saying when to reach for it.

3. **An anchor the engine only guessed at is refused.** `proposePhases`
   records provenance per boundary — `detected`, `fallback` or `coach`.
   Aligning two lifts on two fallbacks would lay one guess on another and
   present the result as a measurement, so `anchorTimeOf` returns null for a
   `fallback` boundary and the interface says the clip start was used instead.
   Peak velocity is the exception: it is a property of the series and needs no
   phase model, so it is computed directly when no boundary carries it.

4. **Every metric declares which direction is better, and some declare
   neither.** `betterWhen: 'higher' | 'lower' | null`. Peak velocity is higher.
   Velocity lost through the transition is lower. **First pull is null** — many
   coaches teach a patient first pull precisely so the second can be faster, so
   a table calling a faster first pull "better" would be teaching the opposite
   of what the coach in front of it teaches. Loop width and peak height are
   null for the same class of reason.

5. **A verdict is a word, never only a colour.** Design hard convention. The
   table prints *better / worse / no change / different / not comparable* next
   to every delta.

6. **A difference inside the noise is "no change".** Per-metric thresholds in
   `SIGNIFICANT` (0,03 m/s for velocities, 40 W for power, 1 cm for lengths).
   Without them every comparison shows nine changes and a coach learns to
   ignore the column. COACH-CONFIG candidate: a marker-tier setup could
   legitimately tighten all of them.

7. **Power across two different bars is `incomparable`, not `worse`.** A
   heavier bar moving slower can out-power a lighter bar moving faster, which
   says nothing about the lifter. Both the caveat and the verdict come from
   one predicate, `massesAreComparable` (tolerance ±0,5 kg — collars and clips
   are not a different bar), so the table cannot contradict the sentence
   underneath it. A test asserts exactly that invariant across four mass pairs,
   because it is the failure the first build actually shipped: "+498 W better"
   printed directly above "power is not comparable".

8. **Grade mismatches are flagged, not blocked.** Design §6.4 allows
   comparison across quality grades and requires the flag. Same for two
   different phase models, where "second pull" means two different things.

9. **The bar path opens at equal aspect and offers a stated exaggeration.** A
   pull is a metre tall with an 8 cm loop; at true proportions the shape being
   compared is a ribbon in an empty box, and auto-fitting to the box is the lie
   the panel exists to avoid. So ×1 / ×2 / ×4 is a control the coach sets, and
   the L-shaped scale bar in the corner has equal arms in centimetres — at ×1
   a square corner, at ×4 visibly four times wider than tall. The distortion is
   in the drawing, not only in a caption.

10. **One hovered moment, both panels.** The delta table answers "which lift
    was faster"; the crosshair answers "where did they diverge", which is the
    next question and the one a table cannot answer. Hovering the velocity
    chart puts the reading in its header (both velocities and the gap) and a
    dot on each bar path at that instant.

11. **Side by side has exactly ONE clock, and it is the viewer's.** The
    comparison is handed the viewer's own playhead rather than opening a second
    one; the reference clip follows the time that playhead is at, converted
    through the aligned clock (`t_reference = t_leader − anchor_leader +
    anchor_reference`). Two clocks drift, and drift on this screen looks like a
    decoding bug rather than a design mistake. So `useFollowerFrame` has no
    play loop at all — it is given a time and decodes the frame nearest to it.

12. **The follower says how near "nearest" was.** Two clips are usually
    different frame rates, so there is rarely a frame exactly at the synced
    moment; a frame at 30 fps is 33 ms of lift and a coach comparing turnovers
    deserves to know it is there. Running out of footage is reported
    differently ("before this clip starts") from a near miss, because the first
    is a coverage problem and the second a precision one, and the same
    arithmetic produces both.

## 3. What P3a shipped

**Engine (pure, `src/kinemos/engine/compare.ts`)** — `anchorTimeOf`,
`alignSeries`, `compareMetrics`, `massesAreComparable`, `comparisonCaveats`,
`ALIGNMENT_LABEL` / `ALIGNMENT_WHY`. 28 tests.

**Data (`src/kinemos/lib/comparisonService.ts`)** — `findComparable` (other
analysed lifts of the same athlete, same exercise first) and
`loadComparisonSubject` (track + calibration + phases → a full kinematic
series, recomputed rather than trusted, so both sides come out of the same
pipeline at the same filter settings).

**Surface (`src/kinemos/components/ComparisonView.tsx`)** — two modes behind one
picker. *Charts*: bar paths overlaid, velocity curves on the aligned clock with
a time axis and a linked crosshair, delta table with worded verdicts, caveats
underneath. *Side by side*: both clips off the viewer's playhead, each with its
own bar path traced up to the moment on screen and its velocity at that instant
(`ClipStage`, `useFollowerFrame`). Reached from a COMPARE toggle in the viewer
header, enabled only when this lift has a calibrated, marked track.

### What the browser pass caught

`verify/drive-gestures.mjs` gained five checks; jsdom can reach none of them,
because there is no layout and every `getBoundingClientRect()` is zero.

- The crosshair's clock runs left to right and **equal pointer steps are equal
  time steps** — the check that fails if a handler reads `clientX` without
  going through the element's own rect, and fails worse the further right the
  pointer goes.
- The gap shown equals the difference of the two numbers shown.
- Leaving the chart restores the alignment caption.
- Exaggeration stretches the path by **exactly** the stated factor (measured
  ×3,999 through the path's own bbox) and leaves the height untouched to
  0,01 cm — the vertical is the measurement, and an exaggeration that moved it
  would be a lie rather than a view.

The design bench (`verify/viewer-preview.html`) also caught two things a
screenshot shows and a test does not: the delta table calling +498 W "better"
above a caveat saying power was not comparable, and the bench rendering the
analysis panel in comparison mode when the real viewer hides it.

### The frame server bug side-by-side exposed

Building this needed the bench to show real decoded video rather than a painted
still, so it now encodes its own two clips (different frame rates, one frame per
track point timestamped with that point's own `t`). Stepping through them
surfaced a **stall in the frame server that had shipped in 0.79.0 and survived
three phases**:

- `CanvasSink` wraps one `VideoDecoder` walking one demuxer. `openFrameServer`
  fired a `getCanvas` per request with nothing between, so dragging the scrub
  strip or holding the step key put dozens in flight at once.
- Past fifty or sixty they **stop resolving, and do not reject either**. The
  picture freezes for the rest of the session while the transport, the readouts
  and the overlay all carry on naming a different moment. `useFrameServer`
  swallowed the failure with a bare `.catch(() => undefined)`, so nothing was
  logged and nothing was shown.
- Why it hid so long: it reads as a viewer that lost sync rather than a decoder
  that stalled, and stepping slowly never triggers it.

The fix is a serial decode queue in `openFrameServer` — one decode at a time,
wanted frames ahead of speculative ones, newest first within a priority, and a
cap on queued prefetches. Both hooks now surface a decode failure instead of
leaving the previous frame up, because a stale frame under a live transport is
how a mark gets stored against a timestamp it does not belong to.

Covered three ways: five unit tests against a mocked sink
(`engine/__tests__/frameServerQueue.test.ts`, four of which fail without the
queue), a concurrency check in `verify/frame-server.html`, and the end-to-end
reproduction in `verify/drive-gestures.mjs` — which needs both fast stepping
**and** GPU readback pressure, and reports "transport on 78, picture on 65"
without the fix.

## 4. Out of scope for P3a

Deliberately deferred, in the order they are likely to be picked up:

- **Synced side-by-side playback.** Design §8 pairs it with the path overlay.
  Deferred because it needs two frame servers and two decoders live at once,
  and the overlay carries most of the value on its own.
- **Metric trends over time.** Was gated on design §13 open question 3;
  decided 02/09/2026 and shipped as P3b (§5).
- **Model-lift comparison.** Third in the design's own ordering; wanted a
  notion of a reference lift, which P3c supplied (§6).
- **Talkover recording, sharing, overlay export.** The rest of P3.
- **Device-profile and phone-model calibration tiers.** Listed under P3 in the
  design plan; unrelated to comparison and independently schedulable. The
  stabiliser tier landed in P3d (§7); the device-profile tier has not.
- **Comparing more than two lifts.** Three curves on one chart is a different
  design problem, and no coach has asked yet.

---

## 5. P3b — Metric trends (shipped 0.84.0)

Design §8's second comparison need: *"is the second pull getting faster over
the block"*. Unblocked by the §13 Q3 decision — KinEMOS metrics stay adjacent
to the Analysis registry, and Analysis reads them through an adapter.

### Architecture decisions

1. **One metric catalogue.** `engine/metricCatalogue.ts` is the single list of
   what KinEMOS measures — id, label, unit, decimals, which way is up, why it
   matters, and a reader that pulls the value off a computed lift. The delta
   table (`compareMetrics`) now maps over it instead of carrying its own copy,
   and the trend view and the Analysis measures list exactly the same set
   (CLAUDE.md core principle 3).
2. **The cache column has a schema.** `kinemos_analyses.metrics` was a bare
   `LiftMetrics`; it is now `LiftMetrics` plus the rep summary under
   `schema: 1` (`toStoredMetrics` / `fromStoredMetrics`). A row from before the
   number reads as schema 0 with no summary, so peak height, loop width and
   duration are null on it rather than zero, and a future change to what is
   stored can be told apart from a season of older rows instead of drawn
   through as one line. No migration: the column was already JSONB and every
   reader is lenient about shape and strict about numbers.
3. **Trends read the cache; comparison recomputes.** Unchanged from P2's
   intent: a trend over a season must not run the pipeline per rep, and a
   comparison the coach is looking at must agree with the viewer beside it.
   A rep with no stored number is *counted* in the trend view's caption, not
   hidden — the missing ones are usually the oldest, and a rising line that
   starts where the data starts is a different claim from one that starts
   where the athlete started.
4. **Velocity is never shown without load.** The time view stacks a load panel
   under the metric on the same time axis — two panels, one scale each, never
   two y-axes on one plot — and the load view puts the metric against the
   kilograms directly. Quality rides on the mark's shape (A filled, B ring,
   C diamond, ungraded cross), never on colour alone.
5. **A KinEMOS rep counts nothing towards training totals in Analysis.** It is
   the set the log already counted, seen on video. Its fact row carries zero
   sets, zero reps, no kilogram load and `countsTowardsTotals: false`; only
   its `custom['kinemos:*']` values are readable, through measures registered
   at runtime beside the coach's own — nothing KinEMOS is in the registry's
   seed, as Q3 was decided.

### What shipped

**Engine (pure)** — `engine/metricCatalogue.ts`: `METRIC_CATALOGUE`,
`metricById`, `toStoredMetrics`, `fromStoredMetrics`, `STORED_METRICS_SCHEMA`.
`compare.ts` refactored onto it; its 28 tests unchanged and green.

**Adapter (`src/kinemos/lib/analysisAdapter.ts`)** — `projectLiftRecords`
(analyses ⋈ library → one flat record per rep with a value per catalogue
metric, grade, error, load, mass, schema), `factsFrom` (long form),
`filterLiftRecords`, `loadKinemosLiftRecords`. `analysisMetrics.ts` —
`kinemosAnalysisMetrics()`: one Analysis `BaseMetricDef` per catalogue metric
(default aggregation by the metric's own sense of "up": max, min or mean) plus
an analysed-rep count and the estimated velocity error behind the grade.

**Viewer (`components/TrendsView.tsx`)** — a TRENDS toggle beside COMPARE.
Metric picker, this-exercise / all-exercises, over-time / against-load, 3–12
months or all. Hover reads the rep out in the header; click opens it. A
dense table of every rep in view underneath.

**Analysis module** — `buildFacts` gained a KinEMOS stream (fed by `fetchFacts`
through the adapter; a KinEMOS read failure leaves the training facts intact),
`AnalysisModule` registers the measures at runtime, `format.ts` knows m/s, cm,
W and s. A coach can now put "Second pull (KinEMOS)" in a pivot next to max
load and tonnage, per week or per date.

**Cache refresh (`lib/recompute.ts`)** — `computeFromBundle` is the one
pipeline over a stored rep, shared by the comparison loader and by
`refreshStoredMetrics`, which rewrites the metrics cache of reps whose stored
schema is behind the current one. The Trends view offers it as a
RECOMPUTE N REPS action beside the caption that counts them, reports what it
could not do (not calibrated, no track, gone) and reads the history again.
The grade is deliberately left alone: it needs the frame server's sample rate
and its variable-frame-rate verdict, which only the viewer has.

**Bench** — `verify/trends-preview.html` renders the view against a
synthetic season (five months of snatches, a few cleans, mixed grades, stale
reps, a simulated refresh); `verify/shoot-trends.mjs` screenshots every state
through Playwright. The first render caught what jsdom could not: the joining
line zig-zagged through same-day reps (now through the day's mean, said so on
the chart), a 0,025 axis step printed as 1,77 / 1,80 / 1,82 (steps are 1, 2,
5, 10 only), y labels sat on the first marks (fixed left inset), and the
single-rep state said the same thing twice.

**Tests** — catalogue round trip and leniency (9), adapter projection and
filters (10), Trends view words, modes and the refresh (11), recompute (8),
KinEMOS fact stream and measures (8).

### Not in P3b

- **Recomputing a rep's grade headlessly.** The refresh rewrites metrics only;
  a grade needs the frame server. A rep graded under an older rule keeps its
  letter until it is reopened.
- **Trend lines in the athlete app.** The adapter makes it a projection
  question; the surface is a product decision.
- **Load–velocity profile fitting.** The against-load view shows the points;
  fitting a line and deriving a minimum-velocity threshold is P5's
  VBT→planner work (design §12).

---

## 6. P3c — The reference lift (shipped with 0.84.0)

Design §8's third comparison need, *versus a model lift*, deferred from P3a
for want of a notion of a reference. This is that notion at its smallest, and
deliberately per athlete rather than a library of ideal lifts: the coach marks
one analysed rep as the athlete's reference for an exercise — their best
snatch, the one that looked right — and the other surfaces read against it.

### Decisions

1. **One reference per (athlete, exercise), kept in the application.** An
   analysis has no athlete or exercise of its own (it names its clip; both
   live on the library row), so the database cannot state the constraint.
   `referenceService.markAsReference` clears the previous holder, found
   through the adapter's join, before setting the new one. Migration
   `20260902200000_kinemos_reference_lift` adds `is_reference` and a partial
   index; nothing else changes shape.
2. **The reference is a standard, not a data point.** The trend view draws it
   as a line whatever the range or scope — narrowing to three months must not
   lose the thing the three months are read against — and only when it has a
   value for the metric on screen.
3. **A reference needs a calibrated, marked lift**, the same gate as
   comparison. Written straight through on toggle, not via the debounced
   save: it is one deliberate act and it has a side effect on another row.

### What shipped

`lib/referenceService.ts` (`referenceOf`, `markAsReference`); `is_reference`
on the analysis row, the adapter record and the comparison candidate. Viewer:
a SET REFERENCE / REFERENCE toggle in the header. Comparison: the reference
lists first for its exercise, marked ★, and is preselected when the picker
opens with nothing chosen. Trends: a dashed line at the reference's value,
labelled with the value and its load, in both the time and the load views;
the reference row marked in the table. Tests: service (5), trends (2),
adapter and fixtures updated.

### Not in P3c

- A library of model lifts across athletes (design §12 P5), and any
  "distance from the model" score. The reference is one athlete's own lift.

---

## 7. P3d — The OpenCV assists (shipped with 0.84.0)

Asked for directly: "why don't we use some of the advanced methods in OpenCV
to enhance the tracker". The answer was measured before anything was built.

### What the bench said (`verify/tracker-bench.py`)

A degraded synthetic snatch — 384×288 at 50 fps, a rotating branded plate,
motion blur scaled to bar speed, a hand sweeping across the plate through the
second pull, sensor noise, camera shake, a real VP8 encode — scored against
the trajectory it was drawn from:

| Tracker | RMS px | worst px | lost |
| --- | --- | --- | --- |
| KinEMOS NCC, fixed template, through the browser | 0,68 | 0,90 | 0 |
| OpenCV `matchTemplate`, fixed template | 0,52 | 1,26 | 0 |
| OpenCV `matchTemplate`, adaptive template | 2,23 | 3,79 | 0 |
| OpenCV Lucas–Kanade optical flow | 2,11 | 4,84 | 0 |
| OpenCV `HoughCircles` per frame | 0,96 | 4,16 | 0 |
| OpenCV `TrackerMIL` | 3,31 | 4,44 | 0 |

Our tracker already *is* the OpenCV method that works for this target — a
fixed-template normalised cross-correlation is what `matchTemplate` computes.
The general-purpose trackers update their model every frame, which is what
makes them robust to appearance change and exactly what makes them drift on
a plate whose appearance changes every frame. So the tracker was left alone.

### What was built instead

OpenCV earns its place around the tracker, not in it. `src/kinemos/cv/*` is
a layer the engine never imports, loaded on first use as its own Vite chunk
(`@techstark/opencv-js`, 13 MB; `opencv.ts` is the one loader, `require()`
under Node for vitest):

1. **Find the plate** (`plate.ts` `detectPlates` → `findPlate`). Hough
   circles over the plausible radius range, ranked by *edge support* — the
   fraction of the circumference with an edge under it — rather than by
   votes, which favour busy backgrounds. One press in the calibration panel
   outlines the plate, marks its centre as the bar end and tracks from it:
   zero clicks from clip to bar path.
2. **Snap to the edge** (`refinePlateEllipse`). Canny edges in a ring round
   the outline; per angular bin the *outermost* edge pixel, so the rim's
   outer edge — the plate's diameter — wins over its inner one; a contrast
   test so wall grain does not qualify; a direct least-squares ellipse fit;
   then the intensity gradient along each radial, interpolated, for the
   sub-pixel edge. Reports the support, so a half-hidden plate is flagged
   rather than passed off. A near-circular fit gets tilt 0 by definition —
   its tilt is noise, and 88° of it once swapped the calibration's axes.
3. **Stabilise the camera** (`stabilise.ts`). Corners on the background
   (`cornerMinEigenVal` and a hand-rolled non-maximum pick, since this build
   lacks `goodFeaturesToTrack`), excluded round the plate, carried by
   pyramidal Lucas–Kanade one frame at a time, and a *similarity* — not a
   full affine; a hand does not shear — fitted by RANSAC from each frame
   straight to the anchor frame's corners, never chained, with a step guard a
   hand cannot exceed. Only the tracked points are corrected; the video is
   untouched. Offered in the grade panel when the clip is handheld or
   unknown; sets the camera to "stabilised".

### Measured, through the real path

| | result |
| --- | --- |
| Zero-click detection on the degraded clip | centre within 0,4 px, tilt 0, radius ≈ 1 px outside the drawn rim (codec blur) |
| Handheld random walk, up to 52 px, raw track vs the gym | 35 px RMS; loop width read as 49 cm for a 17 cm loop |
| Same, stabilised | 1,05 px RMS, 0 frames off; loop 17,2 cm, height 111,3 cm (true 111) |
| Static clip, stabilised anyway | track moved by under 2 px |

Ten unit tests on drawn scenes; `verify/track-clip.html` gained `?auto=1`
and `?stabilise=1`; the bench gained `--handheld` and `--world` scoring.

### The first real footage (0.83.3 fixtures, `verify/fixtures/real/`)

Two clips of the same snatch — "Træk side" (perpendicular) and "Træk skråt"
(oblique), 384×288 at 50 fps, tripod — through `verify/track-clip.html` with
`?auto=1`: zero clicks from clip to bar path, on both.

| | side | oblique |
| --- | --- | --- |
| Plate found | (221,0, 245,1), 28,2×25,8 px, support 1,00 | (244,3, 217,5), 20,9×19,9 px, support 0,90 |
| Tracked | 170/170, min confidence 0,68, never lost | 188/188, min 0,51, 9 doubtful frames at the very end |
| Lift-off → peak | 0,60 s | 0,62 s |
| Peak vertical velocity | 2,55 m/s | 2,16 m/s |
| Height to overhead | 157 cm | 161 cm |
| Recovery peak | ≈1,0 m/s | ≈1,0 m/s |

Same shape (pull, turnover hook, drop, recovery), same timing, heights within
2,5 % — and a 15 % gap on peak velocity that calibration alone cannot explain
in the direction it points. What the real plates showed that the synthetic
ones could not:

- **The plate's shadow inflates the outline downward.** On the side view the
  face is a 52 px circle by intensity profile (r = 26); the snap found a
  56 px major axis at 14° — the outermost edge at the bottom is the shadow's,
  not the plate's. Picking the strongest edge per bin instead gives 27,2:
  better, still a pixel out. A calibration that is 4–8 % large under-reads
  every velocity by the same.
- **A thick bumper seen obliquely has two 45 cm circles**, its face and the
  far edge of its side, offset along the bar. The oblique fit mixes them:
  face-only reads 36 px tall, face-and-rim 44 px. That is a 20 % spread on
  the oblique scale from the choice of outline alone.
- **The oblique view also changes depth along the pull.** The bar travels
  back toward the lifter, which for a camera off the front corner is away
  from the lens: the scale shrinks along the path and the peak under-reads.
  A perpendicular side camera has no such term.

So for *velocities*, film from the side, perpendicular, and let the coach
check the outline against the plate face (the snap reports support, not
which edge it chose); the oblique view is for path shape. Both of these are
now product facts rather than assumptions.

**Superseded by the accuracy study.** The 15 % gap above was explained here
by outline bias and depth; the overnight study that followed
(`docs/KINEMOS_ACCURACY_STUDY.md`) measured each term and found the
explanation wrong in its largest part. The calibration was *rotating*
displacements onto the fitted outline's axes, and the orientation of a
near-circular outline is noise (+11,9° and −16,9° for two level cameras) —
that alone made the 46 cm "loops" and most of the velocity gap. With gravity
as the reference, a timing repair before resampling, the track re-centred on
the plate's outline frame by frame, and a peak-stability factor in the grade,
the two views agree to about 3 % on peak velocity and 2 % on height — and,
once the plate's FACE rather than its shadow and rim thickness sizes the
outline and the scale is read at mid-pull, on a scale that is measured rather
than merely shared. The study is the reference for what the pipeline does
and why; the paragraphs above stand as the record of what the first pass
concluded.

One environment note: the bundled headless Chromium has no H.264 decoder, so
the fixtures were transcoded to VP8 for this run; a coach's Chrome decodes the
MP4 directly.

### Not in P3d

- **Ground truth on real footage.** The numbers above are consistent with
  each other and with a snatch, and nothing here has been checked against a
  hand-labelled track or a known bar path. The 15 % gap is explained, not
  measured away.
- **The device-profile calibration tier** (lens distortion by phone model).
- **Re-rendering a stabilised clip.** The points are corrected, the picture
  is not; a coach watching a handheld clip still sees it move.


## 8. P3e — Sets, and the first phone footage

Three Messenger clips of Caroline's snatch doubles — 576×1024, 30 fps,
phone behind the lifter — were the first whole sets through the pipeline,
and the first footage that was not a tripod at 50 fps. They broke three
things and paid for the fixes (`docs/KINEMOS_ACCURACY_STUDY.md` §3.7–3.8).

### What broke

- **The tracker's search radius** was a fixed 14 px; the bar moves 40 px a
  frame on this footage. It is now derived from the plate's size on screen
  and the clip's frame rate (`engine/tracker.ts`).
- **Giving up** counted a blurred plate as a lost one and ended every rep
  before the catch. A miss now needs an implausible jump as well as a poor
  match; a long run of poor matches still ends the track.
- **A double is two reps and a drop.** The tracker loses the plate on the
  drop, and one track from one click gave the first rep and garbage. Two
  pieces: `engine/reps.ts` cuts a track into reps from rests and rises alone
  (a rest is slow AND on its local floor, so a phone that moved between reps
  and a pause at the knee are both handled; a step faster than any barbell
  ends a rep where the tracker lost it), and the harness's `?reps=1` mode
  finds the plate again after a loss — round is not enough, the candidate
  must correlate with the set's own template, because the fan behind this
  platform is round — tracks on, and calibrates each rep on the outline at
  its own rest.

### What it gives, from one click on the first frame

| | rep 1 | rep 2 | own-rest scale vs the set's |
| --- | --- | --- | --- |
| Set 1 | 2,29 m/s · 136 cm | 2,33 m/s · 129 cm | −4 % / rejected (−14 %) |
| Set 2 | 2,31 m/s · 134 cm | 2,32 m/s · 136 cm | −1 % / −1 % |
| Set 3 | 2,37 m/s · 138 cm | 2,27 m/s · 129 cm | −1 % / +2 % |

Every peak stable across cutoffs to within 1 %, every rep found without a
frame window set by hand. Against the same reps measured earlier with
hand-set windows and per-rep plate finds (2,39/2,39, 2,33/2,25, 2,40/2,20)
the differences are 1–4 %, and all of them are the scale: an 80 px plate
seen obliquely with its thickness and the discs behind it in view is
outlined to ±4 % depending on the frame, which is the accuracy floor for
this kind of footage. Filming from the side, closer, and at the phone's
native quality rather than a Messenger copy would each buy some of it back.

### Not in P3e

- **The viewer does not yet split sets.** The engine and the harness do;
  the viewer still tracks one rep from one anchor. Wiring `splitReps` and
  the re-acquisition into KinemosViewer, with a rep picker, is the next
  slice.
- **Re-acquisition mid-flight.** A plate lost during a pull (the fan case)
  is found again only at the next rest. A colour segmentation of
  competition bumpers would find it in the air.
- **A dense-flow tracker** was tried and is not better on this footage
  (study §3.7).

## 9. P3f — The German analyzer's measures

Simon's 2018 DTU report (*Measurement Systems for Performance Training in
Olympic Weightlifting*, §3.1) tabulates what the German Weightlifting
Analyzer 3.0 reads off a snatch or clean, from the BVDG teaching material,
and what a 40-year coach (Peter Käks) ranked as mattering: Vmax, the x–y
path, t_turn, S_max, S_sit. KinEMOS had the first two and half of the rest
under other names. `AnalyzerMetrics` in `engine/phases.ts` now carries the
full set in EMOS units, computed from the phase spans the coach can already
correct:

| measure | read as |
| --- | --- |
| V1, V2, Vmax, Vmin | peak in the first pull; minimum through the transition; the overall peak; the lowest velocity after it |
| t_turn | Vmax → Vmin |
| S_vmax, S_max, S_fly | height at Vmax; the apex (the catch phase's start, or the first stop after Vmax); their difference |
| S_remain | S_fly minus the ballistic rise Vmax²/2g, in cm and as a share of S_max |
| S_sit, S_fall | the lowest height in the catch; S_max minus it |
| F1, F2, F3, Fbr | vertical force as % of load — (1 + a/g)·100, so no mass is needed — peak in the first pull, minimum through the transition, peak in the second pull, peak in the catch |
| PSK | load × Vmax, N·s, the material's "power"; null without a mass |

Heights are above the bar's first mark; the material's "from ground" values
are these plus the plate's radius. The jerk table (report Figure 10) needs a
dip–drive–split phase model and is not done. The measures are in the metric
catalogue, so the comparison table, the trends view and the Analysis builder
list them; the viewer shows them in an ANALYZER section of the metrics rail;
the stored-metrics schema is 2 and older rows recompute on demand.

### Three rules the phone footage forced

- **A guessed edge yields no analyzer number.** V1, V2, F1–F3 read off a
  transition the engine placed by proportion would be numbers about the
  fallback rule. They are null unless the edge was detected or set by the
  coach (P3 plan §2 decision 3, applied to the analyzer).
- **The transition from acceleration when velocity has no dip.** Five of
  Caroline's six reps show a shoulder, not a trough: the bar keeps rising
  through the knee, only slower. In acceleration the double knee bend is
  unmistakable — a peak as the first pull drives, a trough of 1,3–1,7 m/s²
  as the knees come under, a higher peak as the hips open. `findUnweighting`
  reads the transition from that when `findFirstVelocityPeak` finds nothing,
  the boundaries carry the rules `acceleration-peak` / `acceleration-trough`
  so the coach knows which signature placed them, the threshold is the
  coach's (`minUnweightingMs2`, default 1 m/s²), and V2 is the velocity where
  the second pull starts rather than the span's minimum, which for a
  monotone velocity would be V1 again.
- **A rep ends in the catch, not at the apex.** `splitReps` now runs each
  rep on to the deepest point of the catch — stopping at a recovery, at the
  bar coming to rest, or at a gap in the samples — so Vmin, t_turn, S_sit,
  S_fall and Fbr have the frames they need. `RepSegment` carries `apexT`
  and `catchT` separately.

### What Caroline's doubles read (30 fps phone clips, camera behind)

| | V1 | V2 | Vmax | Vmin | t_turn | S_vmax | S_max | S_fly | S_remain | S_sit | S_fall | F1 | F2 | F3 | Fbr |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Set 1 rep 1 | 1,05 | 1,10 | 2,29 | −0,82 | 0,49 s | 92 | 130 | 38 | 9 % | 96 | 34 | 131 | 114 | 149 | 122 |
| Set 1 rep 2 | 1,02 | 1,10 | 2,33 | −0,79 | 0,59 s | 89 | 129 | 40 | 9 % | 106 | 23 | 132 | 110 | 153 | 139 |
| Set 2 rep 1 | 0,96 | 1,07 | 2,31 | −0,73 | 0,40 s | 91 | 133 | 43 | 12 % | 103 | 31 | 128 | 114 | 149 | 120 |
| Set 2 rep 2 | 0,82 | 0,97 | 2,32 | −0,80 | 0,43 s | 90 | 136 | 46 | 13 % | 105 | 31 | 130 | 113 | 154 | 124 |
| Set 3 rep 1 | — | — | 2,37 | −0,82 | 0,40 s | 96 | 136 | 40 | 9 % | 109 | 26 | — | — | — | 133 |
| Set 3 rep 2 | 0,89 | 0,97 | 2,27 | −0,79 | 0,40 s | 95 | 134 | 39 | 9 % | 121 | 13 | 127 | 110 | 158 | 123 |

Velocities in m/s, heights in cm above the start, forces in % of load. The
consistency across reps is the point: F3 within 149–158 %, S_remain 9–13 %,
Vmin within 0,1 m/s. The forces are second derivatives of a 30 fps track
through a 6 Hz filter and should be read to about ±10 % of load; on 60 fps
or better they tighten. Set 3 rep 1's transition was not found on this
footage.
