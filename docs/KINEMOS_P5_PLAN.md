# KinEMOS P5 — Frontier (build plan)

**Parent:** `docs/KINEMOS_DESIGN.md` §12 (P5) and §13 open question 4.
**Predecessors:** P0–P4 (`_P0_` … `_P4_PLAN.md`); P4d deliberately not built.

> **Status: P5a–P5d SHIPPED.** Load–velocity profiles and velocity loss (§2),
> the model-lift library (§3), live mode (§4), pre-analysed arrivals (§5).
> **P5e — lifter pose tracking — is NOT built, and §6 says why not.**

The design's P5 is four fragments and the phrase *"shapes TBD"*:

> *Live webcam mode (product shape undecided), model-lift library,
> VBT→planner suggestions (LV profiles, velocity-loss cutoffs), 80–99 %
> pre-analysed arrivals.*

Two of them were undecided by design and one was blocked on infrastructure
EMOS does not have. This plan records what each turned out to be once it was
actually built, including the two places where the design's own assumption
about how it would be done turned out to be wrong.

---

## 1. What P5 is for

P0–P4 built a measurement instrument: a clip goes in, a graded set of reps
with velocities, phases, forces and a bar path comes out. P5 is the first
phase that is not about measuring better. It is about the measurement
**arriving where a decision is taken**:

- **§2** turns a season of velocities into a load–velocity profile, which is
  a prediction — the first KinEMOS output that says something about a lift
  that has not happened yet.
- **§3** turns one analysed rep into a teaching object for the whole club.
- **§4** puts the number on the platform, between reps, where the decision
  to stop a set is actually made.
- **§5** removes the click that stood between a clip arriving and being
  analysed, so the instrument is used by default rather than on purpose.

---

## 2. P5a — Load–velocity profiles and velocity loss

`engine/loadVelocity.ts` (pure), `components/LoadVelocityPanel.tsx`.

A load–velocity profile is a straight line fitted through (load, peak
velocity) pairs for one athlete and one exercise. From it come three things a
coach uses directly: the velocity to expect at a given load, the load that
should produce a target velocity, and — by extrapolating to the minimal
velocity threshold — an estimated 1RM that never required a maximal attempt.

**What the fit refuses to do, and why that is most of the value.** A
regression through four points spanning 5 kg will produce a slope, an
intercept and a confident-looking 1RM that is nonsense. So `fitLoadVelocityProfile`
returns a refusal rather than a number when:

| Refusal | Threshold | Reason |
|---|---|---|
| too few points | `< 4` | two points define a line exactly and say nothing about whether it is one |
| too narrow a spread | `loadSpread < 0.15` | a 15 % range of load is the minimum over which the relationship is measurable rather than extrapolated |
| a non-negative slope | `slope >= 0` | velocity rising with load is not a lifter, it is a measurement problem |

C-graded reps are excluded by default. A grade is KinEMOS's statement about
how much a number can be trusted, and a profile built from untrustworthy
velocities inherits that without saying so.

**Velocity loss is measured from the best rep of the set, not the first.**
The literature's cutoffs ("stop at 20 % loss") are defined against the best,
and a first rep that was tentative would otherwise make a whole set look
fresh. `velocityLoss` and `repAtLossCutoff` both work this way.

## 3. P5b — The model-lift library

Migration `20260903180000_kinemos_model_lift.sql` (two columns on
`kinemos_analyses`), plumbed through `analysisService`, `comparisonService`
and the viewer's comparison picker.

P3c gave every athlete a **reference lift**: their own best, which comparison
opens on and trends draw as a line. That answers *"how does this compare to
my good one"*. Design §8 asks a second question the reference lift cannot —
*"how does this compare to a lift that is simply correct"* — because a
novice's own best rep is not a model of anything.

`is_model` marks a rep as an exemplar for the whole environment, offered when
comparing **any** athlete; `model_label` is what it is a model *of*, in the
coach's words ("Textbook second pull", "Where the bar should meet the hip").
A model lift without a name is an anonymous bar path; the label is the thing
that makes it teachable.

Deliberately **not** a separate table: a model lift is an ordinary analysis
with an ordinary track, calibration, phases and grade, and everything that
makes it worth comparing against is the analysis itself. Unlike the reference
lift there is no one-per-anything rule — a club may keep several models of
one lift.

## 4. P5c — Live mode, and the answer to open question 4

`engine/liveReps.ts` (pure), `KinemosLive.tsx`, route `/kinemos/live`.

**Design §13 open question 4 — the live-mode product shape — is answered: a
VBT-unit readout, not live path drawing.** The design left the two open. The
choice is not close, and the reasons are about where a coach's eyes are
rather than about what is technically possible:

1. **A coach watching a screen is not watching the lifter.** A bar path drawn
   live can only be consumed by looking away at the exact moment you should
   not. A number that appears *after* the rep is read in the gap that already
   exists between reps.
2. **The bar path is a review artefact, and KinEMOS already does it
   properly.** Two paths overlaid, phase-aligned, with a delta table, is an
   argument. One path drawn live at 30 fps is a squiggle.
3. **Live has exactly one job the recorded viewer cannot do: the cue.** "Stop
   when the bar has slowed 10 % from your best" has to be decided between
   reps or not at all — and §2's velocity-loss machinery is what answers it.

So the screen is a big number, a set list and a stop cue.

**Why live needed a new rep detector.** `engine/reps.ts` cuts a finished
track into lifts by looking at the whole thing — the local floor within five
seconds either side, the apex, the catch. None of that exists live, where the
future has not been recorded. `liveReps.ts` is a three-state machine fed one
sample at a time:

```
WAITING  --- above armCm, rising --->  RISING  --- stops rising --->  SETTLING
   ^                                                                     |
   +---------------- still for settleS; emit if it rose minRiseCm -------+
```

Three decisions in it are worth naming:

- **The rep is emitted at the catch, not at the apex.** Peak velocity is
  known by the apex — but a bar that rises 60 cm and is *dumped* is not a
  rep, and only the settle tells them apart. ~0,35 s of latency buys the
  difference between counting lifts and counting movements.
- **The floor is learned, not told.** The lowest still height ever seen, kept
  updated, so blocks, a camera nudged between sets, or a platform that is not
  at the bottom of frame all work with no setup.
- **A step no barbell makes is discarded entirely** (`maxSpeedMs = 6`). A
  tracker glitch must not set a peak velocity of 40 m/s — and it must not be
  read as *movement* either, or it would reset the settle timer and the rep
  would never be emitted.

**Tracking without a click per frame.** The plate is found once with OpenCV,
its colour is sampled there, and every frame after that the plate-coloured
patch nearest the last position is found (`engine/plateColour.ts`, from P3g).
That costs a few milliseconds a frame — template correlation and Hough
circles do not — and it is immune to the plate spinning, which live footage
does constantly.

**What live mode does not claim.** Nothing is stored and nothing is graded. A
phone propped against a water bottle, uncalibrated for lens and unchecked for
camera angle, is an everyday-tier measurement at best. The numbers are for
the decision between sets; the clip filmed alongside is what gets analysed
properly. The screen says so rather than implying an authority it has not
earned.

**Not verified headlessly.** Live mode needs a real camera and a real
`getUserMedia`; the container has neither. `engine/liveReps.ts` is tested
exhaustively against scripted sessions (a clean double, a shuffled bar, a
dumped lift, a wobble at the top, a tracker glitch, a raised floor), which is
where all the logic lives — but the camera wiring itself is unverified until
someone opens it on a phone.

## 5. P5d — Pre-analysed arrivals

`lib/arrivals.ts`, wired into `components/ImportControl.tsx` and
`KinemosLibrary.tsx`.

Design §12 puts *"80–99 % pre-analysed arrivals"* in P5 **behind a server and
a model**. P4c removed the model half — `autoAnalyse` needs no click at all.
What remained was the server half, and EMOS is a pure client-side SPA with
nowhere to run one (CLAUDE.md, *Hosting & deploy*).

So P5d takes the other route to the same place: **run the pipeline at the
moment the clip is already in the browser.** Two such moments exist.

1. **On import.** `ImportControl` is holding the decoded, trimmed `File` it
   is about to upload. Analysing *that* costs no download at all — which is
   the one thing a server could not have done better. The clip appears in the
   library first and fills in behind, so the coach is never made to wait.
2. **On sweep.** Everything that arrived before this existed, and everything
   from the athlete app (which never touches a coach's browser), is found by
   `unanalysedClips` and worked through from the library.

Three structural choices:

- **A strictly sequential queue, not `Promise.all`.** A split competition
  recording is six files at once, each analysis holding a `VideoDecoder`, a
  full-resolution frame buffer and a tracker running flat out. Six of those
  in parallel is how a browser tab dies. The test asserts peak concurrency is
  1 rather than trusting the code to stay that way.
- **Stoppable between clips, never mid-clip.** A half-stored set is worse
  than an unanalysed one.
- **The sweep is never automatic on page load.** It is minutes of CPU and
  megabytes of download; starting that because someone opened the library
  would be hostile. It is a button that becomes *Stop sweep* while running.

Analyse-on-import is a setting (`localStorage`, default on, `COACH-CONFIG`
candidate for a KinEMOS settings row) because the cost is a minute of the
coach's own laptop per clip and someone importing a season of footage on
battery should be able to decline.

**"Which clips have no analysis" is a set difference, not a query per clip.**
An analysis names its source polymorphically, so asking per clip is one round
trip each across hundreds of rows. One read of the analyses and one of the
library — which the library page has already done — answers it for all of
them at once.

## 6. P5e — Lifter pose tracking is NOT built

Design §12 says pose tracking *"enters here or P5"*. It does not enter here,
and the reasons are the same shape as P4d's:

1. **It needs model weights over a network this environment does not have.**
   Every usable pose estimator (MoveNet, BlazePose, RTMPose) ships as
   downloaded weights — tens of megabytes from a CDN that is not on the
   artifact allowlist and not reachable from the build container. There is no
   version of this that can be written, run and *measured* here, and shipping
   a pose feature that has never executed would be the one failure mode this
   module has spent five phases avoiding.
2. **The product question is unanswered.** KinEMOS measures the bar because
   the bar is what the load does. Joint angles are a different claim —
   *"your hips rose early"* — and the threshold at which that claim is worth
   making is a coaching decision nobody has stated. A skeleton overlaid on a
   video looks like analysis without being any.
3. **The measurement stack is not obviously ready for it.** A 2D pose from a
   single camera is in the image plane; KinEMOS's own accuracy study
   (`docs/KINEMOS_ACCURACY_STUDY.md`) shows how much camera angle costs even
   for a single point on a plate of known size. A joint angle has no known
   size to calibrate against.

**What would change the answer:** a bundled (not CDN-fetched) model that can
be run in the benchmark harness against clips where the angle is known, plus
one specific coaching claim worth making from a joint angle, stated by a
coach, that the bar path cannot already support. The first two are
engineering; the third is the one that decides whether it is worth doing.

---

## 7. What P5 leaves open

- **Live mode has never run against a real camera.** The engine is tested;
  the wiring is not. First phone session is the verification.
- **Talkover (P3h) is likewise unverified headlessly** — `MediaRecorder` over
  a canvas stream needs a real browser.
- **Four migrations are unapplied** (`kinemos_shares`,
  `kinemos_device_profiles`, `kinemos_training_consent`,
  `kinemos_model_lift`) — the Supabase connector needs re-authorising. Every
  feature that reads them is written and typechecked; none has touched a
  database.
- **VBT→planner suggestions** are half-done: §2 produces the profile and the
  cutoff, but nothing yet writes a suggested load back into a weekly
  programme. That is a planner change, not a KinEMOS one, and it belongs in
  the planner's own plan.
