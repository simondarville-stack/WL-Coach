# KinEMOS P3 — Comparison & sharing (build plan)

**Parent:** `docs/KINEMOS_DESIGN.md` §12 (P3). **Predecessors:**
`docs/KINEMOS_P0_PLAN.md` (library, 0.78.x), `docs/KINEMOS_P1_PLAN.md`
(study room, 0.79.x), `docs/KINEMOS_P2_PLAN.md` (metrics 0.80.0, tracker
0.81.x).

> **Status: P3a SHIPPED in 0.82.0.** The rest of P3 — trends, talkover,
> sharing, overlay export, the calibration tiers — is not started.

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

## 3. What P3a shipped

**Engine (pure, `src/kinemos/engine/compare.ts`)** — `anchorTimeOf`,
`alignSeries`, `compareMetrics`, `massesAreComparable`, `comparisonCaveats`,
`ALIGNMENT_LABEL` / `ALIGNMENT_WHY`. 28 tests.

**Data (`src/kinemos/lib/comparisonService.ts`)** — `findComparable` (other
analysed lifts of the same athlete, same exercise first) and
`loadComparisonSubject` (track + calibration + phases → a full kinematic
series, recomputed rather than trusted, so both sides come out of the same
pipeline at the same filter settings).

**Surface (`src/kinemos/components/ComparisonView.tsx`)** — bar paths overlaid,
velocity curves on the aligned clock with a time axis and a linked crosshair,
delta table with worded verdicts, caveats underneath. Reached from a COMPARE
toggle in the viewer header, enabled only when this lift has a calibrated,
marked track.

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

## 4. Out of scope for P3a

Deliberately deferred, in the order they are likely to be picked up:

- **Synced side-by-side playback.** Design §8 pairs it with the path overlay.
  Deferred because it needs two frame servers and two decoders live at once,
  and the overlay carries most of the value on its own.
- **Metric trends over time.** Gated on design §13 open question 3.
- **Model-lift comparison.** Third in the design's own ordering; wants a notion
  of a reference lift that does not exist yet.
- **Talkover recording, sharing, overlay export.** The rest of P3.
- **Device-profile and phone-model calibration tiers.** Listed under P3 in the
  design plan; unrelated to comparison and independently schedulable.
- **Comparing more than two lifts.** Three curves on one chart is a different
  design problem, and no coach has asked yet.
