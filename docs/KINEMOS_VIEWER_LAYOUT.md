# KinEMOS — the portrait-first analysis viewer (layout revision 4)

**Status: direction, not final.** This is the layout the viewer at
`/kinemos/analysis/:kind/:id` is converging on, taken from Simon's Claude
Design exploration of 08/09/2026 (four turns, fifteen options; the chosen
screen is `4a`). The wireframes were greybox at real EMOS density and are
binding on **structure, behaviour, information hierarchy and wording**, and
advisory on styling. §6 says what 0.96.0 built and what is still open.

## 1. What the revision settles

A coach has just filmed a lift. They want to know, in order: did it look
right, was it faster than last time, and — only if they doubt the numbers —
is the tracking any good. Four decisions follow:

1. **The clip is portrait (9:16).** Coaches film on a phone, in a gym, held
   upright. Every earlier layout assumed a landscape frame and paid for it —
   the bar path got squeezed into a thumbnail and the metric panels into a
   strip. A portrait clip needs about 28 % of a 1440 px viewport, which frees
   the rest for reading.
2. **Progressive disclosure by panel.** The screen opens simple and the coach
   opens depth as they need it. Every panel is collapsible, and a *collapsed*
   panel still shows its own headline value, so nothing is a mystery box.
   Three presets — **Look / Read / Work** — set all panels at once.
3. **Bar path and velocity-over-height are one section, not two.** They share
   the same vertical axis (bar height in cm), so a segmented control switches
   between `Bar path`, `Velocity path` and `Combined` — the last a true
   overlay on one set of gridlines.
4. **Measurement honesty is part of the UI.** Every analysis carries a grade
   and an error margin, and the plain-language verdict is gated on it: a
   +0,04 m/s improvement is reported as real, a +0,01 m/s improvement as
   "level with", because it sits inside the ±0,02 m/s margin.

The bet and its cost, from the wireframe's own note: *a 9:16 clip frees the
whole right half of the screen — so the video and the bar path stand side by
side at full height, and the panel stack gets a real column instead of a
strip. The video is 392 px wide; anything the coach wants to see* in *the
frame needs the zoom, not the layout.*

## 2. Layout

```
┌────┬──────────────────────────────────────────────────────────────────────┐
│ 48 │ header  49px                                                        │
│    ├───┬──────────────┬──────────────┬─────────────────────────────────────┤
│ na │ t │ video        │ bar path     │ panel rail                         │
│ v  │ o │ 392px fixed  │ 322px fixed  │ flex:1, overflow-y:auto            │
│    │ o │ (600 for a   │              │                                    │
│    │ l │  landscape   │              │                                    │
│    │ s │  clip)       │              │                                    │
└────┴───┴──────────────┴──────────────┴─────────────────────────────────────┘
```

- The EMOS sidebar (48 px collapsed) is the app shell's; the viewer does not
  touch it. The **tool rail** (Look / Calibrate / Mark / Distance / Angle /
  Knee) is the viewer's and sits against the video it acts on.
- Column 1 and 2 are fixed width and full height; column 3 takes the
  remainder and is the only scrolling region.
- Below 1200 px the rail drops **under** the two plots rather than shrinking
  beside them (`useMediaQuery` in the viewer; inline styles cannot carry a
  media query). Below tablet the wireframe wants the portrait clip
  full-width with the panels stacked beneath — not built; see §6.

### Header

`◀` back · **KinEMOS** (page title) · context `Athlete · Exercise · DD/MM ·
112,5 kg` (date and load in mono) · grade chip `GRADE A ±0,02 m/s` · spacer ·
`n of 7 panels open` (live) · `DEPTH` + `Look | Read | Work` · **Share**.

The Share button opens the *Notes & sharing* panel and scrolls to it; it is
not a dialog. Reference / model marking moved from the header into *This
lift*, and Compare / Trends into *History & comparison* — each sits with the
thing it is about.

### Column 1 — the clip

Stage (fitted, portrait-natural), transport (existing scrub strip with mark
coverage, flagged frames and lift windows, plus frame stepping), then the
**phase timeline**: one band per phase in its own phase colour, a click jumps
to the phase's first frame, a drag on an interior edge corrects it, a hatched
band is an edge the engine placed by proportion. The accent playhead is the
video's. Caption: `Click a phase to jump to its first frame · drag an edge to
correct it · R resets the edges`. The active hand-tool's readout (a distance,
an angle, the knee) sits at the foot of this column, with the stage it is
read off.

### Column 2 — Bar path (`src/kinemos/components/BarPathPanel.tsx`)

One SVG, `viewBox 0 0 200 540`, height-constrained with a fixed aspect
ratio. Three modes:

| | Bar path | Velocity path | Combined |
| --- | --- | --- | --- |
| Bar-path curve `#185FA5` | ● | – | ● |
| Bar-path markers (start, S_max, S_sit) | blue diamonds | – | ● |
| Velocity curve `#5B51C9` | – | ● | ● |
| Velocity markers V1 `#1D9E75` · V2 `#EF9F27` · Vmax `#5B51C9` · Vmin `#D85A30` | – | circles | ● |
| Bar x tick row | y 518 | – | y 518 |
| Velocity tick row | – | y 518 | **y 532** |
| Legend chips | bar-path row | velocity row | **both rows** |

Marker *shape* separates the series in Combined, because marker *colour*
encodes the event and is reused across both. Two tick rows and two legend
rows are required in Combined — a single baseline collides. **Every tick
label lives inside the viewBox** as `<text>`; an HTML row cannot stay aligned
to a height-constrained plot. Height reference lines at S_max, S_vmax and
S_sit (and the marked knee) are labelled in the right gutter. The current
frame is a ring on each visible curve; a press seeks to the nearest sample
of a visible curve, measured in plot units so the two legs of a loop are
told apart by where they are.

### Column 3 — the panel rail (`RailPanel`, `useViewerPanels`)

Seven collapsible panels in this order. The header row is the click target,
a real `<button aria-expanded>`, chevron label `Open ⌄` / `Collapse ⌃`.

| # | Panel | Collapsed headline | Open content |
| --- | --- | --- | --- |
| 1 | `This lift · rep n` | grade letter | rep pills with each rep's stored peak; three big stats — Top speed (Vmax, at S_vmax) / Bar height (S_max) / Turnover (t_turn), 40 px mono; the verdict callout; reference / model toggles |
| 2 | `Velocity over time` | `peak 1,82 m/s` | the curves with phase tints behind them, the second-series picker, `vs time / vs height`, playhead synced to the video; caption *the playhead is the same one as the video*, `0,00 s … 5,80 s` |
| 3 | `All metrics` | `17 of 21 · vs 22/07` | the existing metrics panel — velocity, bar mass, the BVDG analyzer block, phases — with a **Δ vs last make** column: each number against the same earlier lift the verdict is judged by, a direction word per row (`+0,04 ↑ better`, `+0,03 ↓ worse`, `+1,1 ↑ higher`, `−2,8 ↓ earlier in the pull`), and `same` inside the metric's threshold (`lib/metricDeltas.ts`) |
| 4 | `Tracking & correction` | `3 frames flagged` (danger) / `tracked · 218 frames` / `12 marks by hand` / `not tracked` | path geometry, track / re-track / track the set / marker, the **confidence strip** — the tracker's score on every frame over the clip's whole length, green ≥ 0,80 / amber / red < 0,55, hand marks in the accent, a press seeks (`components/TrackConfidenceStrip.tsx`) — the flagged-frame queue (each row a jump), then *How far to trust this*: the grade's conditions, camera, stabilise, re-centre |
| 5 | `Calibration` | `45,0 cm · θ 28,4°` / `not calibrated` (warning) | the existing calibration panel: find, outline, plate, the two scales, the lens tier |
| 6 | `History & comparison` | `Snatch · last 6` | table Date / Load / Vmax / S_vmax / grade, current row selected, ★ on the reference; a row opens the comparison on it; `Compare with DD/MM`, `Trend over time` |
| 7 | `Notes & sharing` | `2 notes · shared 1×` | send to the athlete or a colleague, export with the bar path burned in, talkover, notes and snapshots |

The wireframe had six; *Notes & sharing* is the seventh because EMOS already
ships those and they have to live somewhere the Share button can open.

**Depths** (`DEPTH_PRESETS`, a COACH-CONFIG candidate): *Look* = the lift
only; *Read* = lift, velocity, metrics, history; *Work* = all seven. Default
on a fresh screen: lift and velocity open. A hand toggle clears the preset —
once the coach composes their own layout it is no longer a preset — and the
composition is remembered **per athlete** in `localStorage`
(`kinemos.viewer.panels.<athleteId>`); server-side preferences are the
production home.

### The verdict (`src/kinemos/lib/verdict.ts`)

Judged against the athlete's most recent earlier analysed lift of the same
exercise **at the same load**; with none at that load, the most recent at any
load, and the sentence names the load. Model lifts are exemplars, not
history. The gate is the wider of the two lifts' grade margins (one-sigma
error on peak velocity), with the catalogue's `significant` threshold as the
fallback for an ungraded row:

- |Δ| > margin → *"Faster / Slower than the last lift at this weight"* /
  *"+0,04 m/s vs 22/07 — larger than the ±0,02 m/s margin of error, so the
  difference is real."*
- otherwise → *"Level with the last lift at this weight"* / *"+0,01 m/s vs
  22/07 — inside the ±0,02 m/s margin of error, so treat it as the same
  speed."*

Never a directional claim for a delta inside the margin.

## 3. One playhead

The frame index is single-source: the stage, the transport, the phase
timeline, the ring on the bar-path column, the marker on the velocity chart
and the flagged-frame rows all derive from it, and any of them moves all of
them. Keyboard: `←`/`→` ±1, `⇧` ±10, space plays, `Home`/`End`, `R` resets
phase edges, `V C M D A K` pick a tool.

## 4. Number formatting

`docs/DISPLAY_CONVENTIONS.md` is binding. Comma decimals; units always shown;
frame numbers zero-padded with the total (`f147`, `frame 189 / 348`); the
vertical and horizontal scales are two numbers and never merged; a delta
carries a direction word, not only an arrow; numerics are mono, tabular,
right-aligned.

## 5. Tokens

Everything is drawn from `src/styles/tokens.css`; the wireframe's hex values
were given to *identify* tokens, not to paste. The only literal colours are
data: the two series (`#185FA5` bar path, `#5B51C9` velocity), the four
event markers, and the phase colours from `DEFAULT_PHASE_SET`. Panels use a
0,5 px border, not a shadow.

## 6. Built in 0.96.0, and what is still open

**Built:** the three-column layout with the landscape fallback (a wider video
column for a landscape clip); the collapsible rail with headlines, the three
depths and per-athlete memory; the bar-path column in all three modes; the
phase timeline under the video; the verdict; the Δ-vs-last-make column in
All metrics, gated per metric on the catalogue's threshold and, for
velocities, the grade's margin, so it never contradicts the verdict; the
history table; the flagged-frame queue and the tracker confidence strip —
the score the tracker already computed per frame is now kept on the stored
point (`KinemosTrackPoint.c`, `lib/trackedPoints.ts`), so the strip and
the flagged list survive a reload; the design bench
(`verify/viewer-preview.html`) showing the split pieces.

**Open, in the order they are worth deciding:**

1. **Below tablet.** The wireframe is a 1440 × 900 desktop screen. Under
   ~1200 px the rail drops under the plots; under ~800 px the clip should go
   full-width with everything stacked. Not built — the mobile athlete app
   is the phone surface, and whether a coach ever opens the study room on a
   phone is an open product question.
2. **The `vs height` toggle on the velocity chart** now duplicates the
   bar-path column. Kept for now (nothing shipped is deleted without
   instruction); retire it once the column has been used for a few weeks.
3. **Overlay chips on the clip** (`bar path` / `grid` / `pose`). The stage
   always draws the path; there is no grid and no pose. Not built.
4. **Depth as a coach setting** — the presets are hardcoded
   (`DEPTH_PRESETS`); parameterise when the three names settle.
