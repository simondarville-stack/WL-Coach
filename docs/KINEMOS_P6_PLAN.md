# KinEMOS P6 — testset follow-ups (0.92.0)

Scope: the four follow-ups the real-footage testset (04/09/2026,
`docs/KINEMOS_P2_PLAN.md` §4) left open, built in a cloud session on
`claude/kinemos-testset-followups-0907` from `origin/main` at 0.91.2. The real
clips are not in the repository (`verify/fixtures/` is gitignored), so
everything here is verified with synthetic tests and the numbers that must be
checked on the clips are listed in §5 for the local session.

The brief said "bump to 0.91.0 last"; `origin/main` had moved to 0.91.2
(tagged comments, the review seen-set fix, the stale-chunk reload) before this
branch was cut, so the bump is to **0.92.0** — the drop stop is a new
capability, which is a MINOR bump either way.

## 1. W1 — a guard against committing on a stale `main`

On 04/09/2026 two local sessions committed 0.84.0–0.86.1 on a `main` that was
45 commits behind `origin/main`; the merge cost a day. `scripts/guard-stale-main.mjs`
runs from the husky `pre-commit` hook, before the typecheck:

- Only when the current branch is `main`. Feature branches are untouched —
  the point of a branch is to be behind.
- `git fetch origin main --quiet` with a 6 s timeout. Offline, slow, or no
  `origin`: the guard says nothing and lets the commit through. A guard that
  blocks on the network would be routed around within a week.
- Refuses when `origin/main` has commits not in `HEAD` (`git rev-list --count
  HEAD..origin/main` > 0), prints the count and exactly what to do: `git fetch
  && git merge origin/main`, or move the work to a branch.
- `EMOS_SKIP_MAIN_GUARD=1` for the one case where committing behind on purpose
  is right (a rollback commit); it is an escape hatch, not a habit.

Decision: a node script rather than shell in the hook, so the fetch timeout
works the same under Git for Windows' `sh` and on a Mac.

## 2. W2 — stop tracking at the drop

The tracker followed a dropped bar to the floor and the rep cut then discarded
those frames — a third of the tracking time on most testset clips. Now
`trackDirection` ends a track once the bar, **after having risen**, falls
faster than a drop speed for long enough to be sure (`stopAtDrop`, default on).

Decisions, in the tracker's own units (pixels, frame indices, real
timestamps):

- **Scale.** `2 · templateRadiusPx ≈ 0,45 m`, the same yardstick
  `searchRadiusFor` uses. A smaller plate makes the rule conservative (the
  bar must fall faster in pixels), never eager.
- **The bound is the rep splitter's.** 2 m/s down (`dropSpeedMs` in
  `engine/reps.ts`): a catch lowers the bar at under ~1,5 m/s and stops; a
  bar let go passes 2 m/s within a fifth of a second and keeps going.
- **For how long.** Every interval in a run of at least three samples
  spanning at least 0,1 s must exceed the bound. Three frames alone would be
  12 ms at 240 fps, where per-frame velocity noise on a small plate is a
  few tenths of a m/s; a tenth of a second of free fall past 2 m/s is a drop
  at any frame rate.
- **After having risen.** The bar must first have been at least 0,25 m
  higher than its lowest point earlier in the pass (about one template
  radius). Without this a track anchored on a bar being lowered from a rack,
  or mid-fall, would end on its first frames; with it the rule only fires on
  a lift that is over.
- **Per direction of TIME, not of walking.** The backward pass from a
  mid-lift anchor walks toward lift-off: in walking order the second pull is
  a fast "fall". The rise-then-fall condition is stated in time order, and
  in the backward pass the frames arrive later-in-time first, so the rise
  that precedes a drop can never be established before the drop is reached.
  The rule is therefore only applied to the forward pass, and the backward
  pass runs to its usual end. Cost of that: none the rep cut does not already
  pay — the backward pass from a post-drop anchor tracks the reversed fall,
  which `splitReps` leaves out as before.
- **Reporting.** `TrackResult.stoppedAt: { index, reason: 'drop' } | null`.
  `gaveUp` keeps its meaning — the bar was lost — and stays false on a drop
  stop. `trackFromAnchor` carries the forward pass's `stoppedAt`.
- **The set tracker joins after a drop stop as after a loss** — except
  that it skips the in-flight colour search (that would find the falling
  plate and track it to the floor, undoing the saving) and goes straight to
  finding the plate at its next rest. `lostAtEnd` stays false when the last
  stop was a drop.
- **The viewer says so.** A plain TRACK that ended at the drop now says the
  track ends where the bar was dropped, not that the tracker lost it.

Verified synthetically (`engine/__tests__/tracker.test.ts`): a trajectory
that rises, catches and free-falls stops within a few frames of the drop
with `stoppedAt.reason === 'drop'` and `gaveUp === false`; a controlled
lowering at under 1,5 m/s does not stop; a fall with no rise before it does
not stop; the backward pass through a second pull does not stop; `stopAtDrop:
false` restores the full track.

## 3. W3 — testset acceptance checklist

A table in `docs/KINEMOS_P2_PLAN.md` (after "After the merge…") stating the
acceptance bar per clip in the numbers the bench already reports — tracked
frames, the rep found, phases detected, grade — with a `verify/testset.html`
URL recipe per clip. Anchor cells the cloud session cannot know are left as
"(local)".

## 4. W4 — luma-region frame reads (design; implementation behind a flag)

Frame supply is now the whole cost of tracking: the frame server's
decode-to-canvas is ~50–100 ms per frame, correlation 6–15 ms. The canvas
step exists because the viewer needs an RGBA picture; the tracker needs the
Y plane of a ~300 px square.

### 4.1 Design

`FrameServer.luma(index, region)` — optional on the interface, present only
when the flag is on:

1. A second mediabunny sink on the same track, `VideoSampleSink`, gives a
   `VideoSample` per timestamp; `toVideoFrame()` hands over the decoder's
   own `VideoFrame`, unrotated, in the decoder's pixel format (NV12 or I420
   on every hardware decoder that matters; the Y plane is plane 0 in both).
2. The requested region is in **display** space (post-rotation, the space
   every stored coordinate lives in). It is mapped back to the coded frame
   through the container rotation — `engine/lumaRegion.ts`
   `codedRectFor(region, rotation, codedWidth, codedHeight)` — and clamped
   to the coded frame. Rotation is one of 0 / 90 / 180 / 270; anything else
   the container cannot express.
3. `VideoFrame.copyTo(buffer, { rect, layout: [{ offset: 0, stride: w }] })`
   copies only the Y plane of that rect (for a multi-plane format the layout
   names one plane; `rect` must sit on the format's sample alignment, so the
   rect is widened to even coordinates first — `alignRect`).
4. The Y bytes are rotated **into display orientation**
   (`lumaToGray(bytes, w, h, rotation) → GrayImage` with `originX/originY`
   at the display-space region origin), so the tracker sees exactly what
   `getGray` serves today, just without the RGBA round trip. The Y plane is
   the decoder's luma — the Rec. 601 weighting `grayFromRgba` approximates
   is what the decoder started from, so the values match to within the
   YUV→RGB rounding.
5. `trackerSourceFrom(server)` prefers `server.luma` when it exists and
   the flag is on; the cache and the backward-run logic are unchanged.

Decode ordering: the sample sink has its own decoder, so a track under the
flag decodes each frame once in the sample sink while the viewer's canvas
sink stays idle. The frame server's one-decode-at-a-time queue must then
also cover the sample sink — two decoders walking the same demuxer are two
seeks per keyframe. That is the part that cannot be verified in jsdom.

### 4.2 What is built

- **`src/kinemos/engine/lumaRegion.ts`** (pure; tested against a frame that
  is a plain object, `engine/__tests__/lumaRegion.test.ts`): the display →
  coded rect mapping under each rotation and its inverse (the same mapping
  mediabunny's `VideoSample.draw` applies to a source rect, checked pixel
  for pixel against a whole-image clockwise rotation), outward alignment to
  the even grid, the copy through `copyTo` with a `rect` (honouring the
  returned plane layout's offset and stride), and the rotation of the bytes
  back into display orientation. Plane 0 is luma for NV12 / I420 / I420A /
  I422 / I444; the RGB(A/X) and BGR(A/X) formats a software decoder may
  produce are weighted with the Rec. 601 coefficients `grayFromRgba` uses;
  any other format (including `null`) declines, and so does a region wholly
  off the frame. Departure from §4.1 step 1: mediabunny's `VideoSample`
  exposes `copyTo`/`allocationSize` itself, so no `toVideoFrame()`.
- **`FrameServer.luma?(index, region)`** in `engine/frameServer.ts`: a
  `VideoSampleSink` built on first use (never when nobody asks), its own
  serialised chain, the canvas decode's single retry, the sample closed
  after the copy. Declines when the clip is served downscaled (`maxEdge`):
  the decoder's frame is full size and the tracker's coordinates would not
  be. Optional on the interface, so the tests' stand-in servers need not
  provide it.
- **The flag**: `lumaRegionReadsEnabled()` in `src/kinemos/lib/featureFlags.ts`
  — `VITE_KINEMOS_LUMA_REGION=1` at build time, or the `kinemos.lumaRegion`
  localStorage key set to `1` in the browser for a local run without a
  rebuild. Off by default. The engine is flag-free; the adapter reads it.
- **`trackerSourceFrom`** takes the luma path when the flag is on, the
  server has it, and the walk is FORWARD (`index >= lastIndex`); a backward
  walk keeps the canvas path, whose 16-frame run decode leans on the frame
  server's cache and which the sample sink has no counterpart for yet. A
  null from the server falls through to the canvas. Same bounded cache
  either way (`lib/__tests__/trackerSource.test.ts`).

Not verifiable here, and therefore on the §5 list: whether two decoders on
one demuxer contend, what a forward run of `getSample` costs against the
canvas sink's cached run, and that the luma image tracks to the same
confidences as the canvas one. If the sink wiring proves unstable it can be
removed without touching the pure module; the flag is the cut.

## 5. Deferred to local verification (the clips)

Run on the `kinemos-bench` server (`.claude/launch.json`, port 5299; restart
it after engine edits — it never invalidates its transform cache).

| What | Where | The number to look at |
| --- | --- | --- |
| W2 on the snatch double (VID20250908, 60 fps portrait) | `verify/testset.html?clip=/verify/fixtures/testset-v2/VID20250908….mp4&frame=60&anchor=573,1408&r=110&auto=1&force=1` | `track:` `range` should now end within ~10 frames of rep 1's drop (before: 561/561 through the drop). `reps:` must still find rep 1 at 1,22–2,36 s — the rep cut is unchanged, it just has fewer frames to discard. TRACK THE SET in the viewer must still find **two** reps (the join after a drop stop is new). |
| W2 on the 1080 × 1440 snatch (VID20250830) | same recipe, `frame=60&anchor=711,1636&r=178` | `range` ends at or before frame 431 with `stoppedAt` `drop`; `gaveUp` false. |
| W2 on the competition snatch (20230930, 30 fps) | `frame=0&anchor=1092,868&r=106` | Still 314/314 if the clip ends before the drop; the rep 6,87–8,17 s and peak 1,92 m/s unchanged. |
| W2 on the close-camera pull (VID20250513) | `frame=30&anchor=548,1100&r=120` | A pull is lowered, not dropped: `stoppedAt` must be `null`, 532/532, grade A. |
| W2 on the training hall (20220824) | `frame=30&anchor=831,1101&r=165` | No lift, so no rise: `stoppedAt` `null`, 533/545 as before. |
| W2 timing | any of the above | `trackMs`: the drop clips should lose the frames between the drop and the end of the clip from the total. |
| W4 (only after the flag is flipped locally) | any clip | `grayMsPerCall` against the value before the flag; the track's `confMin`/`confMedian` and `maxPredictionErrorPx` must be unchanged to the second decimal — the luma plane must give the same picture. |
