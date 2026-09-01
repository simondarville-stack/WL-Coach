# KinEMOS P1 — Viewer & manual toolkit (build plan)

**Parent:** `docs/KINEMOS_DESIGN.md` §12 (P1). **Predecessor:**
`docs/KINEMOS_P0_PLAN.md` (shipped 0.78.0, retrofitted 0.78.1).
This document scopes P1 against the codebase as it actually is.
Ships as a MINOR bump.

> **Status: SHIPPED in 0.79.0.** What changed against the plan during the
> build is corrected in place below; §6 records what was verified.

**P1 promise:** KinEMOS becomes a *usable Kinovea-in-EMOS with zero automated
tracking*. A coach opens a library clip in a study room, steps it frame by
frame on real decoded frames, calibrates against the plate, marks the bar end
by hand, reads the bar path in centimetres, measures a distance or an angle,
and saves a snapshot with a note. Nothing here needs a tracker; everything
here is what the tracker will plug into in P2.

---

## 1. What already exists (P1 builds on, does not duplicate)

| Piece | Where | What P1 does with it |
| --- | --- | --- |
| Library union of `training_log_videos` ∪ `event_videos` ∪ `kinemos_videos` | `src/kinemos/lib/videoLibrary.ts` → `LibraryVideo` | The viewer is opened *on a `LibraryVideo`*; `key` (`log:<uuid>` / `event:<uuid>` / `direct:<uuid>`) is the analysis's polymorphic source reference |
| R2 routes with **Range** support | `worker/index.ts`, `kinemosObjectUrl()` | The frame server range-reads the container; scrubbing never downloads the whole file up front |
| mediabunny demux/decode | dependency since 0.77.0, used by `losslessTrim.ts`, `kinemosProbe.ts` | Frame server, keyframe index, per-frame timestamps |
| Clip probe (fps, vfr, rotation, codec, dimensions) | `src/kinemos/lib/kinemosProbe.ts` | Seeds the quality record; `vfr` is why the frame server is timestamp-addressed |
| `StandardPage`, `Modal`, `Button`, tokens, `formatDateShort` | `src/components/ui`, `src/styles/tokens.css`, `src/lib/dateUtils.ts` | The viewer is EMOS-dense chrome, not a bespoke design system |

## 2. P1 architecture decisions

1. **The frame server is built on mediabunny, not mp4box.js.** The design doc
   named "mp4box demux → `VideoDecoder`". mediabunny is already a dependency
   and already wraps exactly that pipeline (`Input` + `UrlSource` →
   `EncodedPacketSink` for the packet/timestamp table, `CanvasSink` for
   decoded pixels). Adding mp4box would be a second demuxer for the same job.
   Same decision as P0 took for probing and trimming.

2. **Timestamp-addressed, index-presented.** The engine's addressing unit is
   the **presentation timestamp**, because phone video is frequently VFR
   (design §6.3, `kinemos_videos.vfr`). The *coach's* unit is "frame 126 of
   218", so the frame server publishes an index built from the container's own
   packet table: `timestamps[i]` is authoritative, `i` is a label. Anything
   computing dt reads `timestamps`, never `i / fps`.

3. **`CanvasSink`, so rotation is solved once.** WebCodecs decodes *unrotated*
   frames; a portrait phone clip would otherwise need every click un-rotated
   by hand, in every tool, forever. `CanvasSink` applies the container's
   rotation matrix and yields display-space canvases, so the whole viewer —
   overlays, calibration, marks, measurements — works in one coordinate space
   that matches what the coach sees. Stored point coordinates are display-space
   pixels; the rotation that produced them is recorded on the analysis so a
   later re-render cannot silently reinterpret them.

4. **Calibration is a panel, not a gate** (design-brief open question 2).
   A wizard would be wrong here: a coach frequently wants to *look* before
   measuring, calibration gets revisited when the first result looks off, and
   the same clip may be calibrated differently for two different reps. The
   panel is reopenable at any moment, uncalibrated marking is allowed, and
   px-only readouts say so rather than inventing centimetres.

5. **No velocity in P1, deliberately.** Manual marks plus calibration would
   let us divide and print a number — and it would be noise: raw click-to-click
   differentiation at ~2 mm/px amplifies a one-pixel hand tremor into ~±0,1 m/s
   at 60 fps, which is twice the *everyday* accuracy tier and five times the
   hardcore one. Velocity ships in P2 with the thing that makes it honest:
   Butterworth smoothing, phase boundaries, and the A/B/C grade. P1 shows only
   what geometry supports directly — path, calibrated displacement, loop width,
   elapsed time, and hand measurements.

6. **Persistence is per (source clip, rep).** One clip can hold six attempts;
   `kinemos_analyses` is the per-rep record and everything else hangs off it.
   Source is polymorphic (`source_kind` + `source_id`) exactly as the P0 plan
   promised, so a log clip, a competition attempt and a direct import are all
   analysable without moving a byte.

7. **Engine purity is enforced by review, not tooling (yet).** `src/kinemos/
   engine/*` imports nothing from EMOS and nothing from React — mediabunny and
   the DOM only. Promotion to a workspace package still waits for a real
   violation (design §4 rule 3).

## 3. Work breakdown (build order)

### W1 — Frame server (`src/kinemos/engine/frameServer.ts`)

The named P1 deliverable. `openFrameServer(src)` where `src` is a URL or a
`Blob`:

- Builds the **frame index** from a metadata-only packet pass: presentation
  timestamps sorted ascending, plus the keyframe subset. Cheap — no frame data
  is read — and it is the only honest source of "how many frames are there".
- `frameAt(index)` → `{ canvas, timestamp, index }`, LRU-cached (default 24
  frames ≈ a stepping window in both directions) so ← → stepping does not
  re-decode.
- `prefetch(index, radius)` — warms the cache around the playhead in
  presentation order, which is the order the decoder is fast at.
- `nearestIndex(timestamp)`, `durationS`, `displayWidth/Height`, `rotation`,
  `averageFps`, `isVfr` (recomputed from the real timestamps, not trusted from
  the row).
- `close()` releases canvases and the input.

Failure is explicit: `FrameServerUnavailableError` for a container the browser
cannot decode (HEVC on the wrong browser is the common one — P0 already refuses
*both*-undecodable imports, but a WebCodecs-only refusal was allowed through),
so the viewer can say "this clip plays but cannot be analysed here" instead of
showing a black canvas.

Tests cover the pure parts: index construction from a timestamp list,
`nearestIndex` at boundaries and between frames, VFR detection, LRU eviction.
Decoding itself is not unit-testable in jsdom and is exercised in the app.

### W2 — Calibration engine (`src/kinemos/engine/calibration.ts`)

Pure math, no DOM. Input: the plate ellipse the coach confirmed (centre,
semi-axes in display px, tilt), the plate diameter in cm (default 45,
**COACH-CONFIG**), and the frame's dimensions. Output:

- `cmPerPxV` from the ellipse's **major axis** (the plate is a circle in the
  movement plane; its full diameter always projects onto the major axis).
- `viewingAngleDeg` = `acos(minor/major)` — how far off perpendicular the
  camera is.
- `cmPerPxH` = `cmPerPxV / cos θ`, the anisotropic horizontal scale.
- `displacementToCm` / `distanceCm` / `angleDeg` — conversions that decompose
  onto the plate's own axes, so a diagonal is not `px · cmPerPxV` and an angle
  is measured in the movement plane rather than in the foreshortened frame.
- `pathMetrics(points, cal)` — rise, peak above the first mark, loop width
  (total horizontal spread), net drift, path length, elapsed time. Returns the
  same figures in PIXELS with `calibrated: false` when there is no calibration,
  so the viewer stays useful before one and says which unit it is speaking.
- `confidence`: `ok` within ±30°, `wide` beyond it (design §6.1 validity
  limit), plus a `degenerate` case when the ellipse is too small to trust.

Fully unit-tested — this is the module every future number depends on.

### W3 — Viewer surface (`src/kinemos/KinemosViewer.tsx` + `components/`)

Route `/kinemos/analysis/:kind/:id`, lazy, its own chunk — two segments rather
than one packed `log:<uuid>` key, so no library key has to survive URL escaping. Layout follows the
P1 mockups (`mockup/kinemos-p1/Main.dc.html`): header (clip context + grade
placeholder + actions) · tool rail · stage · readout rail · timeline strip.

- **Stage:** a `<canvas>` painted from the frame server, with an SVG overlay in
  the same display-space coordinate system for path, marks, calibration ellipse
  and measurements. Zoom/pan (wheel + drag) because a bar end is ~50 px and
  sub-pixel marking needs magnification.
- **Transport:** ← → step one frame, ⇧← ⇧→ ten, Space play/pause, `,`/`.`
  step (Kinovea muscle memory), speed 0,1× / 0,25× / 0,5× / 1×, Home/End.
  Playback is a timestamp-driven `requestAnimationFrame` loop over the frame
  server — not an `HTMLVideoElement` — so what plays and what steps are the
  same frames.
- **Timeline strip:** the clip's frames as a scrubbable band carrying the
  **mark coverage** (design-brief open question 3: in P1 "which frames need
  attention" means "which frames are still unmarked"; the same strip carries
  tracker confidence in P2), plus rep boundaries.

### W4 — Calibration panel

Reopenable panel: click the bar end → an ellipse appears at a default plate
size → drag centre, axes and tilt handles → the panel shows θ and both scales
live, and refuses nothing. Plate diameter is a field (45 cm default; training
plates and 5 kg discs are smaller). The panel states the two scales separately
and never averages them into one number — the design brief is explicit that an
interface implying a single scale is wrong.

### W5 — Manual marking (the Kinovea baseline)

- Click on the stage in Mark mode → the bar-end point for the current frame,
  then auto-advance one frame (the whole loop is click, click, click).
- A mark can be dragged; a marked frame re-clicked replaces its point.
- The path renders as the polyline of marks, in calibrated centimetres when
  calibration exists, in pixels when it does not.
- Points are stored per rep in `kinemos_tracks` as `{t, x_px, y_px}` — the
  same JSONB shape the P2 tracker writes, so the tracker and the coach's hand
  are interchangeable from day one, and `source: 'manual' | 'tracked'` per
  point records which one produced it.

### W6 — Measurement tools

Distance and angle, Kinovea-style: drop two (or three) handles on the stage,
read the number, keep it or discard it. Distances read in cm when calibrated —
and honour the **anisotropic** scale, i.e. a diagonal is not
`px · mmPerPxV` — in px otherwise. Angles are scale-free but must be computed
in *calibrated* space when calibration exists, or an off-perpendicular camera
reports the wrong angle.

### W7 — Snapshots & notes

- Snapshot = current frame + overlays, composited to a JPEG, uploaded to R2
  beside the clip (`<uuid>-snap-<n>.jpg` via the existing storage module) with
  a note. Row in `kinemos_annotations`.
- Notes without a frame are allowed (`kind: 'note'`).
- Talkovers are P3; the button is not drawn in P1 rather than drawn dead.

### W8 — Migrations & service layer

`kinemos_analyses`, `kinemos_calibrations`, `kinemos_tracks`,
`kinemos_annotations` per design §11, `owner_id` throughout, LWW `updated_at`,
permissive interim RLS matching `kinemos_videos`. Access through
`src/kinemos/lib/analysisService.ts` — no Supabase calls from components.

### W9 — Entry points, verify, ship

- Library row gains **Analyse**; the Review-feed KinEMOS chip retargets from
  `?clip=` to the viewer (P0 §W6 said P1 would do exactly this).
- `npm run typecheck`, `npm test`, `npm run build` with a chunk check: the
  main bundle must not grow (design §4 rule 2).

## 4. Known edges (accepted in P1)

- **Stream-hosted log clips cannot be analysed.** `LibraryVideo.isEmbed` rows
  give an iframe, not a file — no frames, no analysis. The viewer refuses them
  with the reason stated, and the P0 open question (enable Stream MP4 downloads
  vs. accept a grade penalty) stays open. Everything in Supabase buckets or R2
  works.
- **HEVC** clips import fine and play fine in Safari, and fail to open in the
  frame server on browsers whose WebCodecs lacks the codec. Detected up front
  and reported as a browser limitation, not a broken clip.
- **Marking is per rep, reps are declared by hand.** Auto rep-splitting needs
  the kinematics P2 brings; in P1 the coach adds a rep and marks it.
- **Snapshots ride the KinEMOS R2 bucket even for log/event clips.** The source
  video stays where it lives; only the derived JPEG goes to R2. Simplest thing
  that works, and it keeps derived media in one place.
- **No zoom-independent sub-pixel refinement.** The coach's click is the point;
  zoom is how precision is bought. The tracker's centroid refinement is P2.

## 5. Out of scope for P1

Automated tracking, stabilisation, Butterworth filtering, phase detection,
velocity/power metrics, quality grades, comparison, talkovers, sharing,
overlay export — P2/P3 per the design doc. P1 ends with a coach able to answer
"how high did the bar go, how far did it loop, and how long did that take"
without leaving EMOS.

---

## 6. Verified at ship (W9)

- `npm run typecheck` clean; `npm run lint` reports nothing new under
  `src/kinemos/`.
- 794 tests pass across 54 files, including 55 new ones: the frame server's
  index/VFR/LRU logic, the calibration engine (with the anisotropy explicitly
  asserted — a single-scale implementation fails those cases), the viewer's
  formatting rules, and the library-key ↔ source-reference split.
  Six suites need `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` to import
  `src/lib/supabase`; they pass with any placeholder value and fail without
  one, in this branch and before it alike.
- `npm run build`: `KinemosViewer` is its own 44 kB chunk and mediabunny stays
  a separate 576 kB chunk loaded only when a decoder is actually needed. The
  main bundle went 432,16 kB → 432,49 kB (+0,33 kB, the lazy-route
  registration) — measured against a worktree of the previous commit, not
  estimated. Design §4 rule 2 holds.
- Migration `20260901180000_kinemos_analysis` applied to the EMOS project via
  the Supabase MCP server.

### The browser pass (0.79.1)

`verify/frame-server.html` closes the gap the first ship left open. Open it
under `npm run dev`: the page encodes a synthetic clip **in the browser**
(WebCodecs + mediabunny), reads it back through the real
`openFrameServer`, and checks 19 properties. Every frame carries a flat grey
patch whose brightness encodes its own index, so decoding frame *n* and
recovering *n* from the pixels proves frame-accurate **seeking** — not merely
that some frame came back.

It immediately earned its keep. The 0.79.0 frame server passed
`metadataOnly: true` and `verifyKeyPackets: true` together on the packet pass;
mediabunny rejects that combination outright (verifying a key packet means
reading the bitstream, which is what metadata-only skips), so
`openFrameServer` **threw on every clip** and the viewer could never have
opened one. Typecheck, lint and 794 unit tests all passed over that bug,
because nothing in jsdom can call a decoder. Fixed in 0.79.1: the pass drops
`verifyKeyPackets`, and `keyframeTimestamps` is documented as the container's
unverified claim — fine for a scrub hint, and the trim path still pays for
verification where a wrong key packet would corrupt output.

Now green, on Chromium, VP9-in-WebM: frame count, dimensions, average fps,
strictly-ascending timestamps matching what was encoded to under a
millisecond, out-of-order seeks returning exactly the frame asked for,
consecutive stepping, cache re-reads, and the VFR case. That last one also
puts a number on the design's central bet: on a clip that changes rate
mid-recording (30 fps → 24 fps, what a phone does when the light drops),
**20 of 30 frames would land on the wrong frame** under a nominal-fps grid.
Timestamp addressing is not caution, it is the difference between right and
wrong.

Alongside it, `src/kinemos/__tests__/KinemosViewer.test.tsx` renders the
viewer under jsdom: the tree mounts, a streaming embed is refused with its
reason rather than opened onto a black stage, a decoder failure surfaces the
frame server's own wording, and the rail says "pixels" before a plate is
outlined.

**Still not exercised against real footage.** The synthetic clip is
intra-only, unrotated, and 480×270. Real phone video adds long GOPs, rotation
matrices, HEVC, and Range-request delivery off R2 — none of which this harness
reaches. A pass over one real clip in the running app is still worth doing.
