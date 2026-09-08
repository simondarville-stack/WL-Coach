# KinEMOS P7 — track only where a lift is happening (0.93.0)

Scope: the automatic path — the library's zero-click analysis
(`lib/autoAnalyse.ts`) and TRACK THE SET in the viewer — finds the plate on
frame 0 and tracks every frame of the clip at ~150 ms a frame
(decode-to-canvas plus correlation). Most of a clip is set-up, rest between
reps and the walk-away; the drop stop (P6 plan §2) already removes the tail
after each lift, and this removes the rest. Built in a cloud session on
`claude/kinemos-activity-scan-p7` from `origin/main` at 0.92.0 (aa2c35d).
The real clips are not in the repository (`verify/fixtures/` is gitignored),
so everything here is verified with synthetic tests; the numbers to be read
off the clips are in §6, for the local session that merges.

Two passes:

1. **Activity scan, cheap** (`engine/activity.ts`, `lib/activityScan.ts`).
   Decode the whole clip once at thumbnail resolution — a second frame
   server on the same source with `maxEdge` 160 — and per frame compute,
   from the luma thumbnail, motion energy, the vertical centroid of the
   motion and its coverage. A lift is a burst of energy whose motion
   centroid rises, with coverage low enough to be one person and a bar
   rather than a camera pan. Each window is extended backward to the rest
   before it (where the plate finder looks and the tracker anchors) and
   forward to the end of the burst or a cap.
2. **Find and track inside the windows** (W2, W4). Per window: the plate
   finder on the rest frame, then `trackSet` confined to the window's frame
   range; the drop stop still ends each track. Rep cut, phases, grade and
   persistence are unchanged.

A clip with no window found takes today's path — plate on frame 0, track
everything — so recall can never be worse than now. The scan is tuned for
recall over precision: a false window costs a plate search and a short
track; a missed lift costs the rep.

## 1. Decisions

- **Thumbnails, not regions.** The tracker's cost is per-frame decode; the
  scan cannot avoid decoding but it can avoid everything after it. A
  160-px-edge canvas is 160 × 90 (landscape) or 90 × 160 (portrait) —
  14 400 pixels, read in one `getImageData` — and the frame server's own
  `maxEdge` draw does the downscale. The scan opens its **own** frame
  server on the same source rather than downscaling frames from the
  viewer's: the viewer's server is full resolution with a 24-frame cache
  of RGBA canvases, and walking every frame through it would evict the
  coach's stepping window and pay the full-size draw for every frame.
  Cost of the second server: one more mediabunny input on the same URL and
  its own decoder; the two never contend because the scan runs to
  completion before any tracking begins (and in the viewer, in the
  background at low priority).
- **Where the `src` comes from.** `autoAnalyse` receives an already-open
  full-resolution server. Rather than opening both in every caller,
  `AutoAnalyseOptions` gains `src?: string | Blob` — the frame server's own
  source type — and `autoAnalyse` runs the scan itself when it is given
  one; `lib/arrivals.ts` passes the URL it already has. A caller that has
  scanned already (the bench, the viewer) passes `activity` instead and the
  scan is not repeated. No `src`, no `activity`: today's path, unchanged.
- **The engine takes arrays.** `engine/activity.ts` sees `Thumb` objects
  (width, height, a luma array, a timestamp) and nothing else — no canvas,
  no frame server — so the burst logic is tested on thumbnails drawn in
  Node. `lib/activityScan.ts` is the walk: open, `frameAt` in presentation
  order, draw, read, feed. Its walk is tested against a stand-in server
  with an injected thumbnail reader, since jsdom has no 2D canvas.
- **Incremental.** A ten-minute 60 fps session is 36 000 thumbnails —
  half a gigabyte held whole. The engine exposes an accumulator
  (`activityAccumulator`) that takes one thumbnail at a time and keeps only
  the previous one; `activityOf(thumbs)` is the same thing over an array,
  for tests and short clips.
- **Relative energy floor.** Sensor noise differs by an order of magnitude
  between a competition camera and a phone in a dim hall, so "active" is
  measured against the clip's own quiet level: the 20th percentile of the
  energy series. A percentile rather than the minimum because one
  duplicated frame (energy 0) must not set the floor.
- **Coverage rejects pans; the centroid confirms lifts.** A camera pan
  changes nearly every cell; a lift changes the cells the lifter and the
  bar occupy. Coverage is the fraction of cells whose change clears an
  absolute floor. The floor is absolute (luma levels, on cell means), not
  relative: a cell mean over 64 pixels averages sensor noise down to a few
  tenths of a level, so a fixed floor of 1,5 levels is quiet on every clip
  that has been seen and only a real change — a plate edge, a body edge —
  clears it.
- **Recall over precision, explicitly.** A slow heavy first pull is low
  energy; a lift near the top of the frame has its centroid rise clipped;
  a phone close to the platform has the lifter filling half the picture.
  So: the energy threshold enters at 2 × quiet and the burst is extended
  at 1,5 × quiet (hysteresis), the minimum centroid rise is small, the
  "then falls" half of rise-and-fall raises confidence rather than
  gating, the coverage ceiling is 0,6 rather than 0,5, and the minimum
  burst length is 0,4 s rather than 0,6 s. Every one of these is a knob
  in `LiftWindowOptions`, tagged `COACH-CONFIG candidate`, with its
  default and reason beside it.
- **The window's range is a bound on the tracker, not a new tracker.**
  `TrackOptions.stopAtIndex` / `stopBeforeIndex` end the forward and
  backward passes at a frame, reported as `stoppedAt: { reason: 'range' }`
  with `gaveUp` false. `trackSet` takes `range?: { from, to }` and confines
  the first track, the in-flight colour search, the rest search and every
  join to it. A drop inside the range still stops the track with reason
  `drop`, since the drop check runs on the frame before the range check
  would end the loop.
- **Plate finder with a hint, then without.** `findPlate`'s `near` is a
  hard constraint (a candidate more than 1,25 R + 8 px from the hint is
  discarded), so for the second and later windows the finder runs with
  the previous window's plate centre as the hint and, if that finds
  nothing, once more without it — the bar may have been rolled between
  reps. A window whose rest frame has no plate is skipped and said so.
- **Windows found, no reps: fall back.** If every window's track produces
  no rep, the clip takes today's path in full. This costs the training
  hall's worst case a whole track on top of the scan — exactly what it
  costs today plus the scan — and never loses a rep to the scan.
- **The viewer scans on open, once, and remembers.** TRACK THE SET uses
  the windows the way the automatic run does; the timeline band shows them
  as light spans before anything is tracked. The scan runs when the frame
  server is ready, in the background on its own server, and the windows
  are cached in `localStorage` under `kinemos.scan.<kind>:<id>` so that
  reopening an analysed rep does not decode the clip again. A cached
  result is trusted for the same clip; the cache is small (a few windows
  and the timing) and is cleared by hand like any other local key.
- **The rep index across windows.** `trackSet` numbers reps from 1 within
  a call; `autoAnalyse` renumbers across windows so a double found as two
  windows is rep 1 and rep 2.

## 2. W1 — `engine/activity.ts`

Types: `Thumb { width, height, data: Float32Array | Uint8Array, t }` (luma,
0–255, row-major); `ActivitySample { t, energy, centroidRow, coverage }`;
`LiftWindow { restT, fromT, toT, confidence, evidence }` with
`evidence { peakEnergy, quietEnergy, centroidRiseRows, centroidFallRows,
coverage, burstS }`.

`activityOf(thumbs, { cellPx = 8, cellFloor = 1,5 })`: consecutive
thumbnails are differenced on a grid of `cellPx × cellPx` cells (an 8 px
cell on a 160 × 90 thumbnail is a 20 × 12 grid). The cell's value is the
difference of its MEAN luma between the two frames, not the mean of its
pixels' differences: averaging 64 pixels first is what takes sensor noise
out (σ ≈ 0,2 of a level for ordinary noise, 0,9 for a very noisy phone),
whereas a per-pixel |d| is always positive and would put the noise floor
under every sample. Per pair:

- `energy` — mean over cells of |Δ cell mean|, luma levels;
- `coverage` — fraction of cells whose |Δ| exceeds `cellFloor` (1,5
  levels: a plate edge crossing a cell moves it by ten or more, a body
  edge by two to five);
- `centroidRow` — the mean row (in thumbnail pixels, 0 at the top) of the
  cells above the floor, weighted by how far above it they are; `NaN`
  when no cell clears the floor, so still frames do not report a centroid
  at the picture's middle.

Sample 0 has zero energy and no centroid, so samples line up with frames.

`liftWindows(samples, options)`:

| Option | Default | Why |
| --- | --- | --- |
| `quietPercentile` | 0,20 | The clip's own noise level; a percentile so a duplicated frame cannot set it. Sample 0 (no predecessor, energy 0) is left out. |
| `smoothS` | 0,1 s | Energy is smoothed by a centred moving average this wide before thresholding; a lift's energy is sustained over tens of frames, the flicker in a quiet stretch is not. |
| `enterFactor` / `enterMinAbove` | 2 / 0,15 | A sample is active at `max(quiet · 2, quiet + 0,15)` levels. Two, not three: the quiet level is a mean over ~240 cells and barely spreads, so the factor is not there to clear noise but small real motion, and the rise, coverage and length rules do the rest. The synthetic low-contrast slow lift (plates 50 levels above the ground, 1,5 rows a frame) reaches 1,3 × this and is missed at three. The additive floor keeps a clean, near-zero quiet level from making everything active. |
| `holdFactor` / `holdMinAbove` | 1,5 / 0,08 | Once entered, a burst runs while energy stays above `max(quiet · 1,5, quiet + 0,08)` — hysteresis, so the slow first pull and the turnover pause stay inside the burst that the second pull started. |
| `mergeGapS` | 0,25 | Two bursts closer than this are one: the bar is still for a moment at the catch while the lifter is not. |
| `minBurstS` | 0,4 | Below this a burst is a fidget. The brief's 0,6 s is the lower end of a real lift; 0,4 s leaves room for a clip that starts mid-pull. |
| `maxBurstS` | 6 | A burst longer than this (a lifter walking about, a pan that coverage did not catch) is kept but capped and marked down in confidence — never dropped, for recall. |
| `minRiseFraction` | 4 % of height | The motion centroid must rise (row index fall) by this over the burst, measured as the largest rise from any earlier sample to a later one over a 3-sample median of the centroid — taken over the burst's ACTIVE samples only (energy above the enter level). In the hold-level tails the motion is something else (a body lowering before the bar is let go) and the centroid JUMPS from it to the bar when the bar moves; on a synthetic miss that jump read as a 15-row "rise" and made a window of the drop. On a 160-row portrait thumbnail 4 % is 6 rows; a snatch moves the centroid 20–50 rows. Small on purpose: a lift near the top edge is clipped. |
| `coverageMax` | 0,6 | Median coverage over the burst's active samples above this is a pan (or a lifter filling the frame — the close-camera pull is the case to measure in §6). |
| `restLeadS` | 0,5 | How far before the burst the window starts: covers the rep cut's 0,15 s rest and the phase detector's 0,4 s lead. Clamped to the quiet stretch actually there and to the clip's start. |
| `forwardCapS` | 4 | The window ends at the burst's end or this long after it began, whichever is first. A snatch is under 3 s from lift-off to the stand; the drop stop ends the track earlier anyway. |

`restT` is the lowest-energy sample in `[fromT, burstStart]` — the stillest
frame of the lead-in, where the plate finder is surest and the tracker's
anchor sits; `fromT` is the start of the lead-in; `toT` the end of the
window. Windows are disjoint by construction (a lead-in lives in a quiet
stretch, a burst ends where the energy falls under the hold level).

`confidence` in [0, 1] is the product of four factors, each 0–1: energy
ratio (`peak / quiet`, 1 at ≥ 6), centroid rise (1 at ≥ 15 % of height,
0 at `minRiseRows`), burst length (1 in 0,6–3 s, tapering to 0,3 at the
limits) and coverage (1 at ≤ 0,3, 0 at `coverageMax`); a fall of the
centroid after its peak (the catch, the drop) adds 0,15 up to 1. The
evidence carries the raw numbers so the UI can say why.

`windowRanges(windows, timestamps)` maps windows onto frame indices
(`restIndex`, `from`, `to`) by nearest timestamp — the pure half of what
W4 needs.

Synthetic tests (`engine/__tests__/activity.test.ts`) draw a lifter — a
flat rectangle whose top rises through the pull and dips into the catch —
and two soft-edged plates of radius 10 on a textured, noisy 90 × 160
ground at 30 fps, at a real scale (a 45 cm plate is 20 px, a 1,0 s pull
over 90 rows is a 2 m/s bar): still frames with sensor noise → no window;
the bar rolled a pixel and the lifter shuffling (fidget) → no window; a
pan (the wall's texture moves, median coverage above the ceiling) → no
window; a snatch → one window with `restT` in the 0,5 s before lift-off
and `toT` past the overhead hold; a double → two disjoint windows, each
anchored in its own rest; a bar that leaves the top of the frame → still
one window; plates at 50 levels of contrast rising 1,5 rows a frame →
still found; a clip that is nothing but the lift → found from frame 0
(the 20th percentile lands on the pull's slow start, and the second pull
still stands out from it).

## 3. W2 — a range bound on the tracker

`TrackOptions.stopAtIndex` (forward: the last frame the pass may track,
inclusive) and `stopBeforeIndex` (backward: the earliest frame the pass may
reach, inclusive — "before" the anchor in time). When a bound ends a pass
with frames still beyond it, `stoppedAt` is `{ index, reason: 'range' }`;
a bound at or past the clip's end reports nothing, because nothing was
left out. `gaveUp` stays false. Progress totals count only the frames in
range. `trackFromAnchor` reports the forward stop first, as before.

`trackSet(server, anchor, { range: { from, to } })`: the first track runs
with both bounds; the in-flight colour search looks no later than `to`;
the rest search stops ten frames before `to`; a join tracks on with
`stopAtIndex` set so it ends at `to`. A `range` stop is not a drop and not
a loss: it ends the join loop.

## 4. W3 — `lib/activityScan.ts`

`scanActivity(src, { maxEdge = 160, cacheSize = 4, onProgress, shouldStop,
open })` opens a thumbnail frame server (`open` defaults to
`openFrameServer`, injectable for the tests), walks `frameAt(0…n−1)` in
order — the frame server's queue is one decode at a time and sequential
decode is the cheap direction — draws each served canvas onto a
`willReadFrequently` canvas of its own size, reads the luma with
`grayFromRgba`, feeds the accumulator, and closes the server. Returns
`{ windows, samples, frames, totalMs, msPerFrame, thumbWidth,
thumbHeight }`. `scanServer(server, readThumb, …)` is the walk without the
opening, which the tests drive with a stand-in server and a reader that
returns arrays; `shouldStop` lets the viewer abandon a scan when the coach
navigates away.

## 5. W4 — wiring

- `autoAnalyse`: `src` → scan → windows → per window find (rest frame,
  hint, then no hint) and `trackSet` in range → reps renumbered. No
  window, or no reps from any window: today's path. The result gains
  `windows`, `scan: { frames, totalMs, msPerFrame } | null` and
  `fellBack`; `describeAutoAnalysis` says "2 lifts found at 1,2 s and
  6,9 s".
- `lib/arrivals.ts` passes the URL it opened the server from.
- `KinemosViewer`: scans on open (cached per clip), holds `liftWindows`,
  passes them to `ViewerTransport` as light spans with `title` "lift,
  1,2–2,4 s"; TRACK THE SET uses them as the automatic run does, with the
  coach's anchor standing in for the finder on the window it sits in.
- `verify/testset.html`: `scan=1` runs the scan first, logs each window
  and `scan:` `{ frames, msPerFrame, totalMs }`, then anchors on the first
  window's rest frame — at the `anchor` coordinates when given, else where
  the plate finder puts it — and tracks with the window's bounds, logging
  `track:` as before so the before/after frame counts and `totalMs` can
  be compared on the same URL with and without `scan=1`.

## 6. Deferred to local verification (the clips)

Run on the `kinemos-bench` server (`.claude/launch.json`, port 5299;
restart it after engine edits). For each clip, the same URL as the P2
plan §4 recipe with `&scan=1` appended — and always with `force=1`, so the
track is re-run inside the window rather than restored from storage:

```
http://localhost:5299/verify/testset.html?clip=/verify/fixtures/testset-v2/<file>&frame=<f>&anchor=<x>,<y>&r=<px>&auto=1&force=1&scan=1
```

What the bench logs with `scan=1`, and what to record per clip:

- `scan:` — `frames`, `thumb` (must be 90×160 for a portrait clip, 160×90
  landscape), **`msPerFrame`**, `totalMs`, `lifts`;
- `  lift k: <liftT>–<toT> s — rest <restT> s, window <fromT>–<toT> s,
  confidence …; peak … vs quiet …, rise … rows, fall …, coverage …,
  burst … s` — one per window, the evidence being the numbers to quote
  if a threshold has to move;
- `  first lift: frames a–b, rest frame r` and `  plate found on frame r
  at x,y …` — where the track is anchored (the given `anchor` is only a
  hint to the finder; the coordinates it finds are the ones used);
- `track:` as before, now with `range` inside `a–b` and `stoppedAt`
  `range@b` (or `drop@…` when the bar is dropped inside the window);
- `total: scan … + find … + track … = … ms` — against `track.totalMs` of
  the same URL without `scan=1`, the number this phase exists to reduce.

The same URL without `scan=1` (and with `force=1`) is the "before"
column. Everything is also on `window.__BENCH__` (`scan`, `scanRanges`,
`range`, `timings.scanMsPerFrame`, `timings.findMs`, `timings.trackMs`).

| Clip | Windows the scan must return | Before (whole clip) | After (in the window) |
| --- | --- | --- | --- |
| Competition snatch, H.264 1080p 30 fps (`20230930…`, anchor `0 · 1092,868 · 106`) | one, containing 6,9–8,2 s; `restT` in the still before 6,87 s | 314/314 frames, `trackMs` (local) | frames ≈ (8,2 − 6,4) · 30 ≈ 55; the rep still 6,87 → 8,17 s, peak 1,92 m/s |
| Snatch double, HEVC 1080 × 1920 60 fps (`VID20250908…`, `60 · 573,1408 · 110`) | two: one containing 1,2–2,4 s, one containing 6,9–8,1 s; the second's `restT` after rep 1's drop has settled | to the drop stop (local) | two reps found through the windows, 1,22 → 2,36 s and 6,91 → 8,09 s; TRACK THE SET in the viewer must show two spans on the band and still find both reps |
| Close-camera pull, HEVC 1080 × 1920 60 fps (`VID20250513…`, `30 · 548,1100 · 120`) | one containing 2,5–4,0 s. **The coverage number to read:** the lifter fills the frame here; if the window is missing, log `samples` coverage over 2,5–4,0 s — above 0,6 means `coverageMax` must rise, and the pan clip below says how far it can | 532/532 | one rep, grade A, `stoppedAt` `range` or `null` |
| Snatch, HEVC 1080 × 1440 30 fps (`VID20250830…`, `60 · 711,1636 · 178`) | one containing 12,0–13,4 s | 431/457 to the drop | one rep, `stoppedAt` `drop` inside the window |
| Training hall, H.264 1080 × 1920 30 fps, 18 s (`20220824…`, `30 · 831,1101 · 165`) | **none** — the bar is never lifted and the camera pans at the end. If the pan produces a window, log its coverage: that number is the floor `coverageMax` may not exceed | 533/545 | no window → today's path (the fallback), same 533/545; the automatic run on the library must say no lift found |
| Scan cost, every clip | — | — | `scan.msPerFrame` — the decode is the whole of it; the pay-off condition is `scan.msPerFrame · frames < 150 ms · frames skipped`. On the competition clip that is ≈ 250 frames skipped, so the scan pays off under ~120 ms/frame; the expected figure on hardware-decoded 1080p is 5–20 ms |

Then, in the app (`kinemos-dev`, port 5244):

- Open the snatch double in the viewer: within a few seconds of the
  clip opening, the scrub strip shows **two** light spans (hover: "lift,
  1,2–2,4 s" and "lift, 6,9–8,1 s", within a couple of tenths). Reopen
  the rep: the spans are there at once (cached under
  `localStorage` `kinemos.scan.<kind>:<id>`; remove the key to force a
  rescan). TRACK THE SET with the mark on frame 60 must still find both
  reps, and the note must say "inside the 2 lifts the scan marked".
- Import the training hall clip from a file, or sweep it from the
  library: the arrival message must not mention a lift, and the analysis
  must come out as before (no rep; the message says nothing rises 40 cm).
- Import the snatch double the same way: the message must read
  "2 lifts found at 1,2 s and 6,9 s; 2 reps analysed …".

A window that lands a lift outside these spans, or a missed lift, is a
threshold finding to write up here with the sample numbers (`energy`,
`centroidRow`, `coverage` over the span), not a regression to silence:
the thresholds in §2 were set on synthetic thumbnails and the clips are
what sets them.

Two things about the cloud session's own verification, for the record:
`npx vitest run src/kinemos` needs `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` in the environment (any value; six test files
import `lib/supabase`, which throws without them) — the worktree has no
`.env`, the main tree does; and `tracker.test.ts`'s "coarse-then-fine
search" test, untouched here, ran to 5,8 s once under the full suite's
load and hit vitest's 5 s default (it passes alone in every run) — a
`{ timeout }` like its neighbours carry would end that.

## 7. Measured on the clips (07/09/2026, local)

The walk as written called `frameAt` per frame and cost 89 ms a frame on
the competition clip and 153 on the 60 fps double — a 9 s clip took 86 s to
scan, three times what it saved. The per-call retrieval, not the decode, is
the price: one decoder run over the clip through mediabunny's canvas
iterator costs 16 ms a frame on the same clip (the sample sink with a
thumbnail draw, 7 ms, but it does not apply the container rotation, which
the vertical centroid depends on). `FrameServer.stream` is that run;
`scanServer` uses it when present. Scan cost after the change, thumbnails
160 px:

| Clip | Frames | Scan ms/frame | Windows | Real lift found | Automatic path, before → after |
| --- | --- | --- | --- | --- | --- |
| Competition snatch, 30 fps | 314 | 20 (est. from 16 raw) | 4: 0,0–1,1 (settle), 2,6–3,0, **6,9–9,5**, 10,0–10,4 | yes, conf 1,00, coverage 0,10 | ~50 s → scan 6 s + find 3 s + track ~10 s |
| Snatch double, 60 fps | 561 | 20,6 | 2: **1,2–3,2**, **7,0–9,3** | both, conf 1,00, coverage 0,09/0,08 | ~120 s → 42 s |
| Close-camera pull, 60 fps | 532 | 20,4 | 3: **2,5–4,0**, 5,1–7,3 (standing up, conf 0,59), 8,2–8,8 | yes, conf 1,00, coverage 0,15 | ~80 s → 43 s |
| Snatch 1080 × 1440, 30 fps | 457 | 24,7 | 2: 0,0–2,5 (settle), **12,0–15,2** | yes, conf 1,00, coverage 0,16 | ~70 s → ~40 s |
| Training hall, 30 fps | 545 | 23,0 | 4 (the lifter walking, standing, the bar shifted; coverage 0,14–0,20) | no lift in the clip; no rep from any window | ~90 s → ~55 s |

Findings, and what changed:

- **Recall is complete** on the five clips; every real lift is a window at
  confidence 1,00 with coverage 0,08–0,16. `coverageMax` 0,6 was never
  approached — the close-camera pull sits at 0,15, so the constant stands.
- **Precision is partial** and harmless: the plate finder and the rep cut
  reject a false window (the training hall yields no rep from four of
  them), at 5–10 s each. Two kinds recur: a burst at the clip's first frame
  (the camera settling, the lifter walking in; `restT` 0,00) and short
  bursts of 0,4–0,9 s. The shortest real burst is 1,53 s, so `minBurstS`
  is 0,8 (was 0,4): that removes four false windows on the set and no
  lift. The clip-start settle is left in — a clip that starts as the lifter
  is already set is the case the rep cut allows a short first rest for, and
  a rule against it would cost recall to save a few seconds.
- The "training hall: none" row in §6 was a wrong expectation: motion
  alone cannot tell a lifter standing up from a lift, and the design never
  needed it to. The bar is: no false REP, and less time than before.

## 8. After 0.93.0: the scan and playback, and the library (0.94.0)

- The viewer's scan started the moment a clip opened and ran alongside
  playback — two decoder runs on one hardware decoder, and a 60 fps phone
  clip stuttered (07/09/2026). The scan now runs only while the clip is
  paused: it starts 1,2 s after opening, stops on play (`shouldStop`) and
  resumes from the frame it reached (`resumeFrom`; `FrameServer.stream`
  takes a start index). Verified on the competition clip: a scan stopped at
  frame 100 and resumed gives sample-for-sample the same result as one run.
- The library shows an **Analysis** column per clip (`2 reps · A`,
  `waiting`, or `—` for streaming clips) and "N waiting for analysis" in the
  header. The backlog sweep is now **opportunistic**: it starts on its own
  three seconds after the library loads when analyse-on-import is on, the tab
  is visible and the machine is on power (Battery API; a desktop counts as on
  power), one clip at a time with a note saying so, and stops when the tab is
  hidden or left. On battery, nothing starts by itself; the button still
  works.
- Not changed: athlete-app clips on Stream cannot be analysed in a browser at
  all. That is the case for a server-side worker, and where a per-clip cost
  would first appear.

