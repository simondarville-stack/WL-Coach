# KinEMOS P1 — design brief

Paste this whole file into Claude Design as the opening message, and attach
the reference material listed at the end.

---

## The product

**EMOS** is an Olympic weightlifting coaching web application. Its users are
coaches and athletes with **high domain knowledge** — this is an expert tool,
not a consumer app. Every design decision favours **information density,
clarity and low interaction cost** over whitespace or marketing polish. Dense
tables, tight spacing, inline editing. If a screen looks calm and spacious,
it is probably wrong.

**KinEMOS** is EMOS's kinematic-analysis module: a coach picks a lift video
from a library and studies it — barbell tracking, bar path, velocity per
phase, power — in a Kinovea-style environment. It is a premium module.

**What you are designing is P1: the analysis viewer.** The video library that
feeds it (P0) is already built and is not part of this brief.

## The users, and what they are actually doing

A coach receives 100–200 athlete videos a week and brings 10–40 of them into
KinEMOS for real analysis. Sometimes a scientist or assistant drives the tool
alongside the coach and athlete. Athletes never operate it — they receive the
results.

The coach's real question is never "what is the number". It is **"why did that
lift fail when the one last month succeeded"**. A snatch at 1,80 m/s makes it
and 1,77 m/s does not, so the interface has to make small differences visible
and has to be honest about when it cannot resolve them.

## Domain vocabulary (get this right — a designer guessing here will be wrong)

- A **lift** is divided into **phases**: first pull → transition → second pull
  → turnover → catch. Coaches disagree about exactly where the boundaries are,
  so phase edges are proposed by software and **dragged to correct** by the
  coach.
- A **rep** is one lift. A **set** is several reps. Every rep gets its own bar
  path and its own numbers — set-level averages hide what the coach cares
  about.
- **Bar path** is the 2D trace of one barbell end through the lift, seen from
  the side. It is roughly an S-curve. Coaches read it first, before any number.
- **Calibration** converts pixels to centimetres. The weight plate is a known
  circle (450 mm for competition plates); filmed at an angle it appears as an
  ellipse. Its *height* gives the vertical scale, and how much *narrower* it
  looks gives the camera angle — which means the vertical and horizontal scales
  are **different numbers**, and the interface must not imply one scale.
- **Tracking** follows the barbell frame by frame. It sometimes drifts onto a
  rack upright or a plate edge. **The coach must always be able to override it
  in one gesture** — this is the single most important interaction in the
  product. Automation proposes; the coach disposes.
- **Quality grade (A/B/C)** is stamped on every analysis from its actual
  conditions — frame rate, calibration tier, tripod vs handheld, markers vs
  markerless, how many corrections were needed. Handheld everyday footage is
  good to about ±0,05 m/s; the serious tier reaches ±0,02 m/s. **A number is
  never shown without a way to see how far to trust it.**

## What to design

Four states of one desktop surface, 1440×900:

1. **Analysis viewer (the main one).** Video with the bar-path overlay; a
   timeline carrying the phase boundaries; velocity and displacement charts
   sharing one x-axis with that timeline; a rep selector; the per-rep numbers;
   the quality grade; playback transport (frame stepping matters more than
   play/pause).
2. **Calibration.** Confirming the plate ellipse and diameter, showing the
   derived viewing angle and the two scales, and offering a stored per-device
   lens profile.
3. **Tracking and correction.** The track drawn over the video with one point
   visibly wrong, and the act of putting it right — including how the coach
   finds *which* frames need checking without scrubbing all 218 of them.
4. **Comparison.** Two lifts of the same athlete on different dates: bar paths
   together, velocity curves together, and a metric table with deltas. Coaches
   rank this first among comparison needs, ahead of trend lines and ahead of
   comparing against a model lift.

## Visual system — use these exact values

```
Fonts    IBM Plex Sans (UI), IBM Plex Mono (all numbers, tabular figures)
Sizes    22 page title · 16 section · 14 body · 13 label · 11 caption · 10 micro
Accent   #185FA5   hover #0C447C   muted rgba(24,95,165,0.08)
Text     #1A1A18 primary · #5F5E5A secondary · #8B8A83 tertiary
Surface  #FAFAF9 page · #FFFFFF primary · #F4F4F2 secondary · #E9E9E6 tertiary
Borders  rgba(0,0,0,0.08) / 0.15 / 0.25 — hairlines at 0.5px
Spacing  4 · 8 · 12 · 16 · 24 · 32
Radii    4 · 6 · 8 · 12
Status   success #27500A on #EAF3DE · warning #633806 on #FAEEDA · danger #791F1F on #FCEBEB
```

Icons are **line icons on a 16/20/24 grid** (the app uses lucide). Never emoji.

## Hard conventions

- **European formatting throughout.** Dates day-first (`26/08`), times 24-hour
  (`17:42`), decimals with a comma (`1,74 m/s`). Never US formats.
- **Numbers are monospaced and tabular** so columns align and digits do not
  jitter as values change.
- **Colour may never be the only carrier of meaning.** A delta of `+0,04` is an
  improvement in one row and a regression in the next; say which in words or a
  glyph, not only in red and green.
- **Phase colours, chart series colours and grade colours are data, not
  chrome** — they encode meaning and should not be flattened to neutrals.

## Non-goals — do not design these

Front-view or 3D reconstruction; tracking both bar ends; lifter skeleton/pose
overlays; a live webcam mode; any mobile layout (the coach is at a desk);
anything that would let an athlete edit an analysis.

## The open questions I most want explored

1. **Where do the numbers live?** Right rail with charts along the bottom, or
   numbers under the video with the rail given to reps and history? Which does
   a coach look at more while judging a lift?
2. **Is calibration a gate or a panel?** A step-1-of-3 wizard before tracking,
   or something reopenable at any moment? This changes the whole flow.
3. **How does a coach find the frames worth checking** without scrubbing the
   whole clip?
4. **What anchors a comparison** — first frame, bar leaving the floor, or the
   start of the second pull?

## What I am attaching

- PNG exports of my own first-pass wireframes for all four states. Treat them
  as a starting point to argue with, not a target to match. Every number in
  them is a plausible sample, not a measurement.
