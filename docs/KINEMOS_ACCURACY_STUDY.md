# KinEMOS accuracy study — two views of one snatch

**Question.** Two clips of the same snatch, filmed at the same time from two
tripods — "Træk side" (perpendicular) and "Træk skråt" (oblique, about 17° off)
— must give the same bar kinematics. On 0.83.3 they did not: peak vertical
velocity differed by 15 %. This document is the study that found out why, the
methods that were tried, the algorithm that shipped as a result, and what the
two views say now.

**Setup.** `verify/fixtures/real/Træk side.mp4` and `Træk skråt.mp4`,
384×288 at 50 fps, tripod, one 45 cm plate tracked from a click-free start
(`verify/track-clip.html?auto=1`: find the plate with OpenCV, track it, calibrate
from its outline, run the engine). Headless Chromium has no H.264 decoder, so
the harness ran on VP8 transcodes of the same frames; a coach's Chrome plays
the MP4 directly. Every number below comes from the shipped TypeScript engine
through that harness, unless marked as a Python cross-check.

## 1. Where it started

| 0.83.3, `?auto=1` | side | oblique | gap |
| --- | --- | --- | --- |
| Peak vertical velocity | 2,55 m/s | 2,16 m/s | **15 %** |
| Height to overhead | 157,0 cm | 160,6 cm | 2,3 % |
| Loop width | 45,9 cm | 41,4 cm | — |
| Fitted outline | 28,2 × 25,8 px, **+11,9°** | 20,9 × 19,9 px, **−16,9°** | |

A 46 cm loop on a snatch pull is not a bar path; it was the first clue.

## 2. Method

The question "which view is right" has no answer without ground truth, so the
study asked instead which terms in the pipeline could produce a *difference*,
and measured each:

1. **Timing.** Frame-difference parity tests on both clips (duplicated or
   blended frames, field order), and the per-frame steps of the raw track
   against a physical acceleration bound.
2. **Scale.** The height curves of the two views overlaid after aligning them
   in time (least-squares shift on the rising part). Two consistent vertical
   scales overlay; a scale error shows as a proportional divergence.
3. **Orientation.** The engine run with the fitted outline orientation, and
   with it forced to zero.
4. **Tracker.** The template tracker (NCC, the shipped one) against an
   independent per-frame outline fit (Canny + ellipse) seeded by it, with
   both edge-picking rules.
5. **Filter.** The peak at 4, 6, 8 and 10 Hz on each view.
6. **Raw evidence.** Unfiltered per-frame vertical velocities around the peak,
   side by side, aligned by the height curves.

## 3. Findings — the error budget

### 3.1 The outline orientation, used as a rotation — the largest term

`calibrateFromEllipse` used to rotate every displacement onto the fitted
ellipse's axes, on the reasoning that the major axis is the bar's travel
direction. A plate a few degrees off perpendicular is a few per cent from
circular (the side outline was 9 % off, the oblique 5 %), and the orientation
of a nearly circular ellipse is noise: +11,9° on one clip, −16,9° on the other,
for cameras that were both level. Rotating a 160 cm vertical pull by 12°
manufactures a 33 cm horizontal excursion — the loops above — and moves the
vertical component of the peak by several per cent in whichever direction the
noise happened to point.

With the rotation removed and gravity taken as the image vertical, the same
tracks read: side 2,457 m/s, 163,3 cm, loop 10,3 cm; oblique 2,331 m/s,
164,7 cm, loop 15,4 cm. The 15 % gap became 5,4 %; the loops became bar paths.

### 3.2 The scales are consistent to under 1 %

After 3.1, the two height curves overlay to **0,69 cm RMS** over the whole
rise (10–140 cm) once aligned in time — with vertical scales that came from
two separate outline fits on two different cameras. Whatever the absolute
scale error of either (see §6), the two views agree on it. Height at the top
agrees to 0,9 %.

That also settles what the residual 5 % on the peak *cannot* be: a scale term
would show as a 5 % divergence in the heights, and there is none. It has to be
local to the peak.

### 3.3 Frame 46 of the side clip — a lurch, not a timestamp

The raw per-frame vertical steps around the peak, in m/s, aligned:

| t | side | oblique |
| --- | --- | --- |
| 0,85 | 2,08 | 2,11 |
| 0,87 | 2,19 | 2,10 |
| 0,89 | 2,12 | 2,22 |
| **0,91** | **3,56** | 2,29 |
| **0,93** | **1,74** | 2,27 |
| 0,95 | 2,13 | 2,34 |
| 0,97 | 2,29 | 2,34 |
| 0,99 | 2,15 | 2,17 |

Side frame 46 moved 9,2 px against 5,5 px on its neighbours, and frame 47 then
4,4 px. An independent per-frame outline fit (Canny + ellipse, Python) shows
the same: 7,3 px then 4,5 px. The picture itself jumps; it is not the tracker.

Two explanations fit a jump: a timestamp fault (the picture is from a later
instant than its stamp), or a real lurch of the tracked plate. They differ in
what happens afterwards — a dropped field leaves every later frame half a
frame ahead, permanently. Against the oblique view, frame by frame (side minus
oblique height, aligned on the frames before 46):

```
44: −0,4   45: −0,7   46: +1,9   47: +0,8   48: +0,3   49: +0,4
50: +0,5   51: +0,5   52: −0,2   53: −0,1   54: −0,5   55: −0,6
```

The offset appears at 46 and is gone by 52. It is a transient of about 2 cm
that decays over five frames, and the oblique view — same bar, same instant —
shows nothing. A blurred plate at 9 px per frame, or the plate moving on the
sleeve as the bar whips through the second pull, both fit; a timing fault
does not. (A first version of the timing repair read it as a half-frame step
and moved every later frame; that dropped the side peak to 2,21 m/s and was
wrong for the reason above. The shipped repair demands that a step persist.)

The cutoff sensitivity makes the same point from the other side:

| cutoff | 4 Hz | 6 Hz | 8 Hz | 10 Hz |
| --- | --- | --- | --- | --- |
| side | 2,385 | 2,463 | 2,520 | 2,565 |
| oblique | 2,313 | 2,331 | 2,338 | 2,339 |

The oblique peak is a plateau and reads the same at every cutoff. The side
peak moves 7 % between 4 and 10 Hz: there is short-lived energy under it that
the filter partly passes. That is the residual gap, and it is a property of
the side clip's pictures around one frame, not of the pipeline.

### 3.4 The tracker follows appearance; the outline is the plate

Seeding a per-frame outline fit from the tracker's point and taking the fit's
centre instead — the geometric plate rather than its face pattern — changes
the side view and leaves the oblique alone:

| tracker | side | oblique | gap |
| --- | --- | --- | --- |
| Template (NCC), shipped since P2 | 2,463 m/s · 163,3 cm · 10,3 cm | 2,331 m/s · 164,7 cm · 15,4 cm | +5,7 % |
| Outline centre, outermost edge | 2,376 · 160,0 · 10,5 | 2,308 · 162,9 · 15,9 | +2,9 % |
| Outline centre, strongest edge | **2,280 · 160,8 · 10,5** | **2,308 · 163,1 · 15,8** | **−1,2 %** |

Peak stability (spread between 4 and 8 Hz) goes with it: side 5,5 % → 3,1 %,
oblique 1,1 % → 1,2 %. The disc turns on the sleeve, blurs through the second
pull and is lit differently at the top of the pull than at the bottom; a fixed
template locked onto its face moves relative to its rim by a pixel or two
through exactly the frames where velocity is highest. The outline does not
care what is printed on the plate. Picking the strongest edge rather than the
outermost keeps the plate's shadow — which grows and shrinks with the lighting
along the pull — from pulling the centre with it.

### 3.5 What did not matter

- **Frame rate and duplication.** Both clips are genuine 50 fps; no blended
  or duplicated frames.
- **Depth change on the oblique view.** Two plates visible in the oblique clip
  give a near/far radius ratio of 1,010 — a 16° azimuth, consistent with the
  outline — and no measurable change of scale along the pull.
- **Per-frame scale tracking.** The fitted plate radius shrinks 6 % from
  bottom to top of the pull *in both views*, the perpendicular one included:
  that is shadow and background, not distance, and applying it as a scale
  would have been wrong by the same 6 %.

## 4. The algorithm that shipped

Five changes, all in the engine's own terms, all tested:

1. **Gravity-anchored calibration** (`engine/calibration.ts`). The ellipse
   gives two scales. Which way is up is the image vertical, rotated by an
   explicit camera roll (`rollDeg`, default 0 — a tripod; the ellipse is never
   asked for it). The outline's orientation steers only how the two scales are
   shared between the image axes, through a construction that tends smoothly
   to a uniform scale as the outline tends to a circle — so the one case where
   the orientation is worst determined is the case where it matters least. A
   vertical image displacement is always purely vertical in the result.
2. **Timing repair** (`engine/timing.ts`), before resampling. A step change
   beyond a physical bound (40 m/s², and never below five times the track's
   own jitter) marks a suspect; a quadratic through the frames before and
   after, with the frames after free to slide in time, says whether it is a
   spike (only the suspect off), a step (everything after off by the same
   amount, confirmed on a second later window), or an event (no slide fits —
   a catch, a bounce). Samples are moved in time, never in space; a sample
   the curve cannot reach is dropped. Reported per rep, and in the grade.
3. **Outline re-centring** (`lib/assists.ts`, RE-CENTRE ON THE OUTLINE in the
   grade panel). The tracker's point seeds a per-frame edge fit; the fit's
   centre replaces it where enough rim was found. OpenCV, on demand, like the
   other assists; the engine stays pure.
4. **Peak stability** (`peakStability` in `engine/kinematics.ts`; grade factor
   "Peak stability"). The peak recomputed at two-thirds and four-thirds of the
   chosen cutoff; the spread says how much of the number is the lift's and how
   much the filter's. Fair past 4 %, weak past 8 %.
5. **The panel says what the orientation is.** "Plate tilt" is now "Outline
   orientation", with the explanation that it does not decide which way is up.

## 5. Before and after

| | side | oblique | gap on peak |
| --- | --- | --- | --- |
| 0.83.3 | 2,55 m/s · 157 cm · 46 cm loop | 2,16 m/s · 161 cm · 41 cm loop | 15 % |
| Gravity-anchored calibration | 2,457 · 163,3 · 10,3 | 2,331 · 164,7 · 15,4 | 5,4 % |
| + timing repair | 2,463 · 163,3 · 10,3 | 2,331 · 164,7 · 15,4 | 5,7 % |
| + re-centred on the outline | **2,280 · 160,8 · 10,5** | **2,308 · 163,1 · 15,8** | **1,2 %** |

Heights within 1,4 %, loops within 0,3 cm, peaks within 1,2 % — from two
cameras 17° apart, with no hand correction on either. The timing repair moved
the side peak only 0,006 m/s on this footage (it re-timed frame 46 by 0,7
frames as a spike); its value is what it does to a clip that *does* have a
dropped field, which the tests plant and recover to 0,5 %.

## 6. Open, and honestly so

- **Absolute scale.** The two views agree with each other; neither is checked
  against a known distance. The auto-found outline on the side view reads
  23,7° off perpendicular for a camera that was perpendicular — the
  near-circular fit cannot place its orientation, and its axis ratio carries
  the plate's shadow — so the *horizontal* scale on that clip is about 9 %
  too large and the loop widths above are upper bounds. Vertical scales are
  what the peaks and heights use and those agree.
- **Camera roll** has a parameter and no source yet. A plumb reference (a
  rack upright, the platform edge) or the stabiliser's rotation on a handheld
  clip would give it; on a tripod it is zero.
- **The oblique outline** can be the plate face or the far rim edge, 20 %
  apart; the auto-find picked consistently here. A coach should see which
  edge the snap chose.
- **A second plate.** The far plate in an oblique view is a second, nearly
  independent measurement of the same bar; tracking both would average out
  what happened at frame 46.
- **Ground truth** remains the missing piece: one clip with a measured drop
  height or a marked bar would turn agreement into accuracy.
- **Cutoff.** 6 Hz stays the default (Winter-corrected, the lifting
  literature's usual choice). The stability factor now tells a coach when a
  peak depends on it. COACH-CONFIG, as before.

## 7. Reproducing it

```
npm run dev
npm i --no-save playwright-core
# side, click-free
OUT=/tmp/side QUERY='clip=/verify/fixtures/real/Tr%C3%A6k%20side.webm&anchor=0&auto=1&plate=45' node verify/shoot-track.mjs
# oblique, with a hint at which plate
OUT=/tmp/skra QUERY='clip=/verify/fixtures/real/Tr%C3%A6k%20skr%C3%A5t.webm&anchor=0,244,218&auto=1&plate=45' node verify/shoot-track.mjs
# variants: &outline=1[&pick=strongest]  &cutoff=4  &norepair=1  &tilt=0  &roll=2
```

Each run logs the calibration, any timing repairs, the peak with its
stability spread, and writes `result.json` with the series for a comparison
like §3.
