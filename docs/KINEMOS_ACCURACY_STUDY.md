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

### 3.6 The absolute scale — what a round 45 cm plate settles

The plate is 45 cm and round (Simon, the morning after the first pass). On
the perpendicular clip, then, its outline must be a circle, and it is: the
face's edge points lie on a circle of radius **25,8 px to 0,38 px RMS** over
88 % of the circumference. The shipped fit had read 28,2 × 25,8 px at 12°,
because it kept the OUTERMOST edge in every direction — and a bumper plate on
a bar is three edges, not one:

- the boundary of its **face** against what is behind it — the 45 cm;
- above that, its **thickness**: with the bar on the floor the camera looks
  slightly down on the plate and the rim of the cylinder shows as a lighter
  crescent past the face's top edge, about 2 px here;
- below that, its **shadow**, merging with the bottom edge.

Outermost-per-bin picked the crescent at the top and the shadow at the
bottom and made the plate 9 % taller than it is. Both views had the same
bias in the same direction, which is why their heights agreed with each
other while both were wrong.

The fix in `refinePlateEllipse` (`pick: 'face'`, now the default) is the
largest edge the WHOLE circumference agrees on: a circle — three parameters
cannot bend round a partial arc — is fitted through the outermost edge per
bin and the points standing outside it are dropped until none do; the
requested shape is then fitted only through the points within a few per cent
of that circle. On the side clip that gives 26,2 × 25,7 px at tilt 0 (a
circle fit: 25,9 px, residual 0,44 px). A `shape: 'circle'` option fits the
circle directly for a plate a coach knows to be round and filmed square-on;
it is a checkbox in the calibration panel.

The floor frame is still the wrong place to read the scale. Re-fitting the
outline on every frame of the track (which the re-centre assist does anyway)
and grouping by height:

| vertical semi-axis, px | bottom third | middle third | top third |
| --- | --- | --- | --- |
| side | 26,34 | **26,46** | 26,58 |
| oblique | 20,45 | **20,16** | 20,15 |

Mid-pull the plate is at camera height and is only itself. The oblique
floor-frame fit read 20,98 px (the shadow of a plate resting on the floor,
which the circle test does not fully separate at 20 px); mid-pull it reads
20,16 px, steady to 0,3 % into the top third. So the re-centre assist now
also reads the scale there: the median outline over the middle third of the
track's height, placed at the frame nearest that band's centre, becomes the
calibration. With both views read at mid-pull the heights agree — 171,6 and
168,0 cm — where the floor-frame face fits had them 7 % apart.

One more known dimension is on every clip: the bar's sleeve end, **ø50 mm**,
at the plate's centre. At 384 × 288 it is six pixels across and no use as a
scale; on 1080p phone footage it is 25–40 px, it IS the bar's axis, it does
not turn, blur barely touches it and it has no rim, thickness or shadow. It
is recorded as `BAR_SLEEVE_END_DIAMETER_CM` and is the reference the next
accuracy step should track and calibrate on (§6).

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
6. **The face is the plate** (`pick: 'face'`, default in `cv/plate.ts`): the
   largest edge the whole circumference agrees on, settled with a circle
   before the ellipse is fitted, so neither the shadow below nor the rim's
   thickness above can size the plate. `shape: 'circle'` — "Round plate,
   camera square-on" in the calibration panel — fits the circle directly.
7. **The scale is read at mid-pull.** The re-centre assist returns the median
   outline over the middle third of the track's height and the viewer makes
   it the calibration, at the frame nearest that band's centre.

## 5. Before and after

Every row is the full click-free path through `verify/track-clip.html`;
the last two rows are the shipped defaults (the last with the round-plate
circle on the perpendicular view).

| | side | oblique | gap |
| --- | --- | --- | --- |
| 0.83.3 | 2,55 m/s · 157 cm · 46 cm loop | 2,16 m/s · 161 cm · 41 cm loop | 15 % |
| Gravity-anchored calibration | 2,457 · 163,3 · 10,3 | 2,331 · 164,7 · 15,4 | 5,4 % |
| + timing repair | 2,463 · 163,3 · 10,3 | 2,331 · 164,7 · 15,4 | 5,7 % |
| + re-centred on the outline | 2,280 · 160,8 · 10,5 | 2,308 · 163,1 · 15,8 | 1,2 % — but both scales 5–9 % small (§3.6) |
| + face edge, scale at mid-pull | **2,323 · 171,6 · 10,4** | **2,389 · 168,0 · 16,3** | **2,8 % on the peak, 2,1 % on height** |
| … side as a circle | 2,379 · 172,4 · 10,3 | — | 0,4 % / 2,6 % |

Peak stability on the final rows: side −0,2 % / 2,1 %, oblique 1,3 % — the
re-centred track no longer carries the frame-46 transient into the peak.
The agreement is now between numbers whose scale is measured (§3.6), not
between two numbers biased the same way. The timing repair moved the side
peak only 0,006 m/s on this footage (it re-timed frame 46 by 0,7 frames as a
spike); its value is what it does to a clip that *does* have a dropped
field, which the tests plant and recover to 0,5 %.

## 6. Open, and honestly so

- **The oblique camera is above the bar, not beside it.** Its mid-pull
  outline is 20,16 × 19,81 px with the longer axis vertical; its face edge
  radii on the floor frame were 19,3 px at the top and 20,1 px at the side.
  Those two readings disagree on which axis is the long one, which at 2 %
  from circular is within what a 20 px plate can tell. If the camera is
  elevated the vertical scale is the minor axis and 1–2 % larger still; that
  is the size of the remaining height gap. A plate twice as many pixels
  across would settle it, and so would the sleeve end.
- **The sleeve end, ø50 mm**, is the better reference at phone resolution
  (§3.6): the bar's own axis, round from every angle, no rim, no shadow.
  Detecting it inside the plate outline and tracking it is the next step
  for accuracy; at 384 × 288 it cannot be done.
- **Camera roll** has a parameter and no source yet. A plumb reference (a
  rack upright, the platform edge) or the stabiliser's rotation on a handheld
  clip would give it; on a tripod it is zero.
- **The re-centred track is jittery** — a per-frame edge fit scatters more
  than a template match — and the timing repair drops or re-times three to
  eight of its frames per clip, mostly in the descent. The noise gate keeps
  it from inventing steps; the frames it does touch are listed in the grade.
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
# the shipped path: face edge, re-centred, scale at mid-pull (add &shape=circle on a square-on view)
OUT=/tmp/side QUERY='clip=/verify/fixtures/real/Tr%C3%A6k%20side.webm&anchor=0&auto=1&plate=45&radius=28&outline=1&midpull=1' node verify/shoot-track.mjs
# variants: &pick=strongest|outermost  &shape=circle  &cutoff=4  &norepair=1  &tilt=0  &roll=2
```

(`radius=28` on the side clip: the template tracker gave up at the second
pull with a template exactly the plate's face, 25,8 px; a little context
round it keeps the lock. The viewer's FIND uses the fitted semi-major axis,
which is the same number — worth a margin there too.)

Each run logs the calibration, any timing repairs, the peak with its
stability spread, and writes `result.json` with the series for a comparison
like §3.
