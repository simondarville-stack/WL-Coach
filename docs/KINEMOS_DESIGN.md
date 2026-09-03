# KinEMOS — Design Document

**Status:** Draft v1 — under discussion, not yet locked. Phase plan at the end is
the convergence proposal.
**Date:** 01/09/2026
**Owner:** Simon (product) · Claude (co-design/implementation)

KinEMOS (Greek *kínēma*, movement) is the kinematic analysis module of EMOS:
in-depth Olympic weightlifting video analysis and VBT built on barbell tracking,
integrated with the plan, the log, and the messaging layer. The name is fixed:
**KinEMOS**, styled exactly like that.

---

## 1. Vision & positioning

A coach receives 100–200 athlete videos a week through EMOS. Most get a glance
in the Review Feed; 10–40 deserve real analysis. KinEMOS is where those go: a
Kinovea-style study environment in the browser that produces quantified,
comparable, shareable lift analyses — bar path, phase velocities, power — with
the automation of a modern VBT app and the manual-override honesty of Kinovea.

What makes KinEMOS different from every hobby barbell tracker and standalone
VBT app is that it does not live alone:

- **The plan** supplies mass (prescribed/logged load) → power is free.
- **The log** supplies context (athlete, exercise, date, set) → every analysis
  is automatically situated in the training history.
- **The Inbox / Review Feed / club layer** supply distribution → results reach
  athletes and colleague coaches through channels that already exist.
- **The Analysis module** supplies trend infrastructure → KinEMOS metrics
  become time series next to everything else.

**Positioning:** premium module (future subscription tier). Smart and automated
wherever possible, but *always* manually overridable — the Kinovea principle.
Automation proposes, the coach disposes.

## 2. Users & roles

- **Operator:** the coach — or a scientist/assistant working alongside coach
  and athlete in a lab/platform setup. Desktop-class browser assumed; no
  low-end-hardware constraint.
- **Consumers:** athletes (receive annotated snapshots, talkover clips,
  numbers via the athlete app/Inbox) and colleague coaches (club layer).
  Athletes do not operate the analysis environment in v1.

## 3. Scope and non-goals

### In scope (across phases)

- Video library: every athlete/competition upload lands there automatically;
  direct import into KinEMOS also possible; unattached videos allowed.
- Upload-time trimming (deliberately frictionless — trimming is the main
  storage-cost lever and must be easier than not trimming).
- Semi-automated single-bar-end tracking with human-in-the-loop correction.
- Calibration ladder: plate-ellipse 2D calibration (±30° off-perpendicular),
  optional per-athlete device profiles, best-effort phone-model lookup,
  handheld-shake stabilisation, explicit quality grading of every result.
- Phase detection (auto-proposed, coach-adjustable) and a coach-configurable
  metric set: pull velocities, velocity loss, peak velocity, 2D bar path,
  power, turnover speed — full quantity list to be supplied by Simon and
  folded into §9.
- Comparison: path overlay / side-by-side (first), metric trends over time
  (second), model-lift comparison (third).
- Annotation: snapshots with drawings, voice + screen-recording talkovers,
  notes; sharing to athletes, colleagues, and exportable overlay video.
- Consent-based collection of coach-corrected tracks as future ML training
  data (the data flywheel).

### Explicit non-goals (v1 line; revisit later)

- **Zero-click tracking.** v1 is click-to-anchor + supervise. Server-side
  "video arrives 80–99 % pre-analysed" is a future upgrade the architecture
  must keep open (§4), not a v1 requirement.
- **3D / stereo / front-view reconstruction.** Side-on 2D only, camera within
  ±30° of perpendicular per the filming convention.
- **Both bar ends / bar rotation.** One end, simple and robust.
- **Lifter pose tracking** (joint angles via e.g. MediaPipe). In scope as a
  named later phase, not at the start.
- **Live webcam mode.** Later phase; product shape (VBT-unit readout vs live
  path drawing) deliberately undecided.
- **Auto-suggesting planner edits from VBT data.** The end-game (velocity-loss
  cutoffs, load-velocity-profile-driven prescriptions feeding the planner),
  but only once enough data exists. Metrics-into-planner display precedes
  metrics-driving-planner logic.
- No real-time collaboration; last-write-wins as everywhere in EMOS.

## 4. Architecture & placement

**Decision: same repo, isolated sub-package, one hard internal boundary.**
A separate app repo would tax exactly the integration that is KinEMOS's moat.
Research/ML work (literature, Python prototyping, tracker benchmarking, model
training) goes to a separate `kinemos-research` repo when started.

```
src/kinemos/
  engine/          # PURE core: tracking, calibration, filtering, phases,
                   # metrics. Zero imports from the rest of EMOS. No React,
                   # no Supabase. Frames/points in → tracks/metrics out.
  components/      # viewer, library, comparison, annotation UI
  hooks/ lib/      # data layer (Supabase, R2), EMOS integration
```

Boundary rules:

1. `engine/` imports nothing from EMOS; EMOS never imports from `engine/`
   directly — only through `src/kinemos/` public surface.
2. `/kinemos` is a lazy-loaded route; all heavy deps (OpenCV-WASM, ONNX
   runtime, video machinery) sit behind dynamic imports in their own chunks.
   The main bundle (≈395 kB post-perf-review) must not grow. Checked at build.
3. `engine/` starts as a folder with the import rule, promoted to a formal npm
   workspace package only if the boundary keeps getting violated.

**Processing model:** all analysis runs client-side in the coach's browser
(WebWorker + WASM/WebGPU). No per-video server compute cost; the coach is at
the machine anyway. The "keep the door open" clause for future pre-analysis: the
engine's pure-function design means the same code can later run in a Worker/
container batch job over R2 objects without rewriting — inputs are frames and
parameters, outputs are JSON tracks.

**Storage:**

- **Raw video → Cloudflare R2.** Free egress (video playback is egress-heavy),
  cheap at rest, sits next to the existing Cloudflare hosting. Rough budget at
  full intake: 200 videos/wk × ~30 MB trimmed ≈ 6 GB/wk ≈ 300 GB/yr ≈
  $4.50/month at year one's end — acceptable. Retention: keep everything until
  manually deleted (current answer); revisit when scale demands (extracted
  data + snapshots are permanent regardless; raw video is the expirable part).
- **Everything derived → Postgres (Supabase).** Tracks (time series as JSONB —
  a 6 s lift at 60 fps is ~360 points, trivially fine), calibration records,
  metrics, annotations, share records. Follows the `owner_id` pattern so the
  future auth/RLS phase needs no schema surgery.

**Backend surface:** EMOS already has an `/api/*` Worker (`worker/index.ts`,
currently Cloudflare Stream upload brokering for log clips). KinEMOS extends
it with R2 routes using a native **R2 bucket binding** — upload/serve/delete
through the Worker directly, no presigned URLs and no stored S3 keys; the
serve route implements Range requests for scrubbing. Interim soft-gating
applies (athlete access codes / coach gate); the premium entitlement becomes a
real check in the auth/billing phase, a feature flag until then.

## 5. Video pipeline

### 5.1 Capture convention ("How to film")

A one-page tutorial (later: in-app checklist on the athlete upload sheet):

- Film **from a distance** (long-ish framing avoids wide-angle distortion;
  ultrawide lens forbidden), roughly **20–45° on the barbell** so the plate
  shows good visible height *and* width (this is what powers 2D calibration,
  §6.1), camera at **~1 m height**, approximately centred on the lift
  vertically. 60 fps preferred. Tripod/bench > handheld (grade-relevant, §6.4).

### 5.2 Ingestion paths

1. **Automatic:** every video uploaded anywhere in EMOS (athlete app training
   uploads, competition clips, Review Feed) is automatically in the KinEMOS
   library, carrying whatever context it already has (athlete, exercise, set,
   date, logged load).
2. **Direct import:** drag-and-drop / file-pick straight into KinEMOS.
   Attachment to athlete/exercise optional — unattached videos are first-class
   (seminar clips, other clubs' lifters).

### 5.3 Trim-on-upload

Frictionless trimmer at upload time (scrub, set in/out, done — two drags and a
confirm). Design intent: trimming must be *easier than skipping it*, because a
trimmed clip is 5–10× cheaper to store and nicer to analyse. Trim before
upload where the platform allows (saves bandwidth too); otherwise server-side
trim-on-arrival can come later.

### 5.4 Library

Dense, filterable table (EMOS style): athlete, exercise, date, load, source
(log/competition/direct), analysed-or-not, quality grade once analysed.
Actions: open in analysis environment, open source log entry, delete (manual
deletion is the retention policy for now). Review Feed video cards get an
"Open in KinEMOS" action.

## 6. Tracking & calibration

### 6.1 Calibration ladder

Every analysis records which calibration tiers applied; tiers compose.

- **Scale + viewing angle (always, cheap):** coach confirms an auto-suggested
  plate bounding ellipse (click bar end → engine proposes plate outline →
  coach adjusts height/width handles). The plate is a circle in the movement
  plane: its visible **height** gives the vertical px→cm scale directly
  (IWF plate = 45 cm default; plate diameter coach-configurable —
  smaller/non-standard plates exist); its visible **width** is foreshortened
  by cos θ of the viewing angle. Two axes → anisotropic 2D calibration that
  both estimates θ and corrects horizontal displacement, valid within ±30°
  off perpendicular. Known residual: in-lift depth change of the bar relative
  to the camera (second-order; carried in the accuracy budget).
- **Lens distortion (best-effort → optional profile):**
  - *Convention tier:* distance framing + no ultrawide ≈ negligible
    distortion on modern phones (main lenses are ISP-corrected).
  - *Model-lookup tier:* read phone make/model from video metadata (QuickTime
    atoms; reliable on iPhone, common on Android, sometimes stripped) and
    apply a stored correction where we have one. Best-effort only.
  - *Profile tier:* per-athlete stored checkerboard photo/frame on the athlete
    profile → proper distortion coefficients. The "serious setup" tier;
    everything works without it, grade reflects it.
- **Shake stabilisation (handheld):** before tracking, stabilise the clip
  against static background features (rack uprights, platform edges) via
  optical flow / feature tracking, so handheld micro-movement doesn't pollute
  the bar track. Applied automatically when motion is detected; visible in the
  quality record.

### 6.2 Tracking ladder

Coach-visible quality/effort tiers:

1. **Anchor + supervise (v1 core):** coach clicks the bar end on frame 1 and
   confirms the plate ellipse; a classical tracker (template/CSRT-class +
   optical flow, mask-averaged centre) follows through the lift. Coach scrubs
   the result; any correction click re-anchors the track from that frame
   (bidirectional re-track). Kinovea principle: manual override is always one
   click away, never a mode switch.
   - **Implementation note (decided 01/09/2026):** the OpenCV tracking API
     (`TrackerCSRT`/`TrackerKCF`) lives in opencv_contrib and is **not in
     the stock opencv.js WASM build**. Rather than owning a custom WASM
     toolchain, hand-roll the tracker from primitives that *are* in stock
     opencv.js: `matchTemplate` + `calcOpticalFlowPyrLK` + masked-centroid /
     `fitEllipse` sub-pixel refinement. Adequate for this target (large,
     high-contrast, rotation-symmetric disc), and the correction loop needs
     to reach inside the tracker anyway. Two practical rules: plates **spin**
     during a lift, so the template mask is an annulus (lettering excluded —
     this is why "mask-averaged centre"); and track coarse at reduced
     resolution, refine the centre at full resolution for sub-pixel.
     Everything else §6 needs is in the stock build (`fitEllipse`, Canny/
     contours, `goodFeaturesToTrack` + LK flow + `estimateAffinePartial2D`
     for stabilisation).
   - **Corrected by measurement (P2b, 0.81.0).** Two of the three assumptions
     above did not survive contact with a ground-truth test. The details are in
     `docs/KINEMOS_P2_PLAN.md` §4; in short:
     - **OpenCV was not needed for the tracker** — and, measured again in
       P3d against the library's own trackers on degraded footage, still is
       not (`docs/KINEMOS_P3_PLAN.md` §7). It IS used, lazily loaded, for the
       work around the tracker: plate detection, sub-pixel outline snapping,
       and the stabiliser tier of the calibration ladder (`src/kinemos/cv/*`).
     - For this target — one large,
       high-contrast disc, anchored by the coach — normalised cross-correlation
       over a masked template with parabolic sub-pixel refinement reaches
       0,04 px RMS on synthetic images and 0,09 px through a real
       encode/decode round trip, in a few hundred lines of TypeScript and no
       9 MB WASM payload. `src/kinemos/engine/tracker.ts`.
     - **The annulus mask made things worse.** The reasoning was sound —
       plates spin, so exclude the rotating face — but measured, cutting the
       middle out throws away most of the pixels that localise the disc and
       roughly doubles position error by an inner radius of 0,7. A ring does
       hold slightly higher correlation through a spin; correlation only has to
       clear a threshold, while position error is the product. The default now
       masks nothing and the inner radius stays a parameter.
     - The third assumption held: coarse-then-fine search is worth having, and
       is implemented as a stride-2 pass followed by a full-resolution sweep of
       the winner's neighbourhood.
2. **Marker mode:** high-contrast marker/sticker on the bar end cap for
   hardcore setups → tighter, more repeatable centres (the 0.02 m/s tier,
   §6.4).
3. **ML mode (later):** automatic bar-end/plate detection removes the anchor
   click; modern point-trackers (CoTracker/SAM-2-class, exported to
   ONNX/WebGPU) as the research track in `kinemos-research`. Coach corrections
   collected under consent are exactly the training data this tier needs (§10).

### 6.3 Signal processing

Raw pixel tracks are differentiated twice (velocity, acceleration/power), so
noise handling is mandatory:

- **Timestamps, never frame indices.** Phone video is frequently variable
  frame rate (iPhone especially); velocity is dx/dt, and a nominal fps on a
  VFR clip corrupts every derived number. The engine consumes per-frame
  timestamps (WebCodecs supplies them); `kinemos_videos` records
  `fps_avg` + a `vfr` flag (probed from mp4box's sample table at import),
  and VFR is a quality-grade input (§6.4). Butterworth assumes uniform
  sampling — resample VFR series onto a uniform grid before filtering.
- Default: low-pass Butterworth (biomech-standard, ~4–6 Hz cutoff at 60 fps),
  applied to the calibrated position series before differentiation.
- Filter type/cutoff coach-configurable (COACH-CONFIG); raw-vs-smoothed
  toggle in the viewer so the filter is never invisible magic.
- Sub-pixel centre estimation in the tracker (centroid/fit) before any
  filtering — at ~2 mm/px, whole-pixel tracking alone cannot reach the
  hardcore accuracy target.

### 6.4 Accuracy model & quality grades

Two operating points, honestly separated:

- **Everyday:** ±0.05 m/s on peak velocity — achievable handheld,
  convention-only calibration, anchor + supervise.
- **Hardcore:** ±0.02 m/s — success/failure in a snatch can be 1.80 vs
  1.77 m/s. Requires the serious tier: tripod, 60 fps, marker mode,
  profile-tier calibration, sub-pixel tracking.

Every analysis carries a **quality grade (A/B/C)** computed from its actual
conditions (fps, calibration tiers applied, tripod vs stabilised handheld,
marker vs markerless, correction density) and shown wherever numbers are
shown. Comparisons across grades are allowed but flagged. The grade is the
product's honesty mechanism — numbers are never presented as more precise
than their provenance supports.

## 7. Phases & metrics

- **Phase boundaries** (first pull / transition / second pull / turnover /
  catch) are auto-proposed from bar kinematics; the coach drags markers to
  correct. Phase *definitions* (what event delimits what phase) live in a
  coach-configurable registry — coaches genuinely disagree here; hardcoding is
  a red flag (COACH-CONFIG).
- **Per-rep everything:** a 3-rep set yields three bar paths and three metric
  rows; set-level aggregates are derived, never the primary record.
- **Metric set (initial, small — grows once data exists):** first-pull
  velocity, second-pull velocity, speed loss first→second, peak velocity, 2D
  bar path (+ derived path descriptors later), power (from logged/entered
  mass), turnover speed. **The authoritative quantity list is pending from
  Simon and will replace this placeholder.** Each metric registers in the
  Analysis metric registry so trends live beside existing analysis.
- **Mass source:** logged load when the video is attached to a set; manual
  entry otherwise; source recorded.
- **Planner integration:** display first (KinEMOS metrics visible in
  planner/analysis context), *suggestion* later (velocity-loss cutoffs,
  LV-profile-driven prescription hints) — explicitly a data-rich later phase.

## 8. Analysis environment (the study room)

Kinovea-inspired, EMOS-dense:

- Frame-accurate scrubbing, variable-speed and frame-step playback, keyboard
  driven.
- Track overlay (path drawn on video), calibration overlay, phase markers on
  a timeline strip, synchronized velocity/position charts under the video
  (Recharts), rep selector.
- Correction loop as §6.2: click to fix, engine re-tracks.
- **Comparison (priority order):** (1) overlay two paths / side-by-side
  synced playback (sync by phase marker, e.g. both at bar-off-floor), (2)
  metric trend lines over time for the athlete/exercise, (3) vs model lift.
- Measurement hand-tools in the viewer (distance, angle) for ad-hoc Kinovea
  work beyond the automated metrics.

## 9. Annotation & sharing

- **Snapshots:** frame + drawn overlays (lines, angles, path segment) + text
  note, saved as first-class objects attached to the analysis.
- **Talkovers:** record microphone + screen (viewer canvas) while scrubbing —
  MediaRecorder-based — producing a share-ready clip of the coach talking
  through the lift. Stored audio is fine; no speech-to-text requirement.
- **Sharing targets — all of:** athlete (athlete app / Inbox), colleague
  coaches (club layer), and export (mp4 with burned-in overlay for external
  use — seminars, socials). Sharing rides existing EMOS channels; no new
  messaging infrastructure.

## 10. ML data flywheel, consent & privacy

- With consent, coach-corrected tracks (video reference + human-validated
  point series + calibration record) are collected as training data for the
  future ML tier. Corrections are the most valuable labels — hard frames get
  human answers by construction.
- Athlete video is personal data. To state explicitly now, enforce in the
  auth phase: raw video lives in R2 under coach/club ownership; athletes see
  their own; consent for training-data use is per-athlete, recorded,
  revocable; the future RLS phase must cover video/track/annotation tables
  (hence `owner_id` discipline from day one).

## 11. Data model (sketch)

New tables (all `owner_id`-carrying, timestamps everywhere, LWW):

- `kinemos_videos` — R2 key, athlete_id?, exercise_id?, training_log ref?,
  source (log/review/competition/direct), duration, fps_avg + vfr flag,
  resolution + rotation, codec, phone-model metadata, trim provenance,
  uploaded_by/at.
- `kinemos_calibrations` — video ref, tier flags, plate ellipse px, plate
  diameter cm, viewing angle θ, distortion source (none/model/profile),
  stabilisation applied.
- `kinemos_device_profiles` — athlete ref, device label, checkerboard asset
  ref (R2), distortion coefficients.
- `kinemos_tracks` — video ref, rep index, point series (JSONB: t, x_px,
  y_px, x_cm, y_cm), tracker tier, correction count, filter settings.
- `kinemos_analyses` — video ref, phase marker set, metric values (per rep),
  quality grade + grade inputs, mass + mass source, analyst, status.
- `kinemos_annotations` — analysis ref, kind (snapshot/talkover/note),
  payload/asset ref (R2 for media), created_by/at.
- `kinemos_shares` — annotation/analysis ref, target (athlete/club
  member/export), channel, shared_at.
- Phase-definition and metric-definition registries (coach-config), likely
  merged with/adjacent to the existing Analysis metric registry — resolve at
  build time against what `src/lib/analysis` already has (single source of
  truth per concept).

## 12. Phased build plan (proposal — to tear apart, then lock)

- **P0 — Pipeline & library.** *Shipped in 0.78.0/0.78.1.* R2 bucket + routes on the existing `/api/*`
  Worker, trim-on-upload, `kinemos_videos`, automatic ingestion from existing
  upload paths, direct import, library UI, Review Feed "Open in KinEMOS"
  action. Detailed scope: `docs/KINEMOS_P0_PLAN.md`.
  *Ships value alone: organised, trimmed, cheap video library.*
- **P1 — Viewer & manual toolkit.** *Shipped in 0.79.0; scope and outcome in
  `docs/KINEMOS_P1_PLAN.md`.* Lazy-loaded `/kinemos/analysis/:kind/:id` route,
  study-room viewer (scrub/step/speed), manual plate calibration (ellipse
  confirm → anisotropic 2D), manual point marking frame-by-frame (Kinovea
  baseline), distance/angle tools, snapshots + notes. **Named deliverable: the
  WebCodecs frame server** — HTML5 `<video>` seeking is not frame-accurate and
  `currentTime` maths off a nominal fps breaks on VFR clips, so frame-accurate
  stepping and marking already depend on it; P2's tracker then consumes it for
  free. Built on **mediabunny** (`EncodedPacketSink` for the timestamp table,
  `CanvasSink` for decoded, rotation-corrected pixels) rather than the mp4box
  this plan originally named: mediabunny arrived with the 0.77.0 clip editor
  and wraps the same demux → `VideoDecoder` pipeline, so mp4box would have been
  a second demuxer for one job. A second frame-server slice was built locally
  in parallel (`engine/video/frameServer.ts` + `frameTiming.ts`, preserved as
  tag `archive/kinemos-p1-frame-server`) and superseded by this one on
  02/09/2026; its durable contribution — one VFR rule shared by the import
  probe and the frame server, plus duplicate-timestamp removal in the frame
  table — was folded in with 0.83.1. *KinEMOS is already a usable
  Kinovea-in-EMOS with zero automated tracking.*
- **P2 — Assisted tracking & metrics.** *Shipped in 0.80.0 (measurement
  pipeline) and 0.81.0 (tracker); scope, decisions and measurements in
  `docs/KINEMOS_P2_PLAN.md`.* Engine: anchor + supervise tracker, Butterworth
  pipeline, phase auto-proposal + coach-adjustable markers, per-rep metric
  computation, quality grades. *The core product.*
  **Built in two halves, metrics first** — a tracker and a filter shipped
  together give a coach a first velocity with no way to tell which of the two
  is lying. Deferred out of P2 and still open: shake stabilisation, marker
  mode, and folding KinEMOS metrics into the Analysis metric registry (design
  §13 open question 3, still unanswered).
- **P3 — Comparison & sharing.** Path overlay + synced side-by-side, metric
  trend views, talkover recording, sharing to athlete/colleagues, overlay
  export. Device-profile calibration tier + model-lookup tier.
  *P3a (comparison) shipped in 0.82.0 (charts) and 0.83.0 (synced side-by-side
  playback); scope, decisions and what the browser pass caught are in
  `docs/KINEMOS_P3_PLAN.md`.* Two lifts overlaid — bar paths, velocity curves
  on a shared clock, a delta table that says which direction is better in words
  and withholds the judgement where "better" has no meaning — plus both clips
  playing off one clock. Two lifts align on a shared physical event — §8's
  "sync by phase marker", lift-off by default — and an event the engine only
  *guessed* at is refused as an anchor. Building the second half exposed a
  **decode stall that had shipped with the frame server in 0.79.0**: overlapping
  `getCanvas` calls stop resolving past a few dozen and never reject, freezing
  the picture under a transport that carries on. Fixed with a serial decode
  queue; see the P3 plan. *P3b (metric trends) shipped in 0.84.0* once §13 Q3
  was decided: one metric catalogue in the engine, a read-only adapter that
  projects stored analyses for the trend view and for the Analysis module's
  measures, and a TRENDS view in the viewer that never shows velocity without
  load. *P3c (the reference lift) shipped in the same 0.84.0*: a coach marks
  one analysed rep as the athlete's reference for an exercise; comparison
  opens on it and trends draw it as a line. *P3d–P3g shipped in 0.84.0 to
  0.86.0*: the OpenCV assists, the two-view accuracy study, sets tracked
  from one click with each rep at its own calibration, the German
  analyzer's measures, colour re-acquisition, charts against height and the
  knee mark (P3 plan §7–§10). Sharing, talkover, overlay export and the
  device-profile calibration tier are untouched.
- **P4 — Intelligence.** `kinemos-research` repo: literature, benchmarking on
  labelled clips, consented flywheel data collection wired in-product;
  ML-assisted detection/tracking (toward zero-click and server-side
  pre-analysis); lifter pose tracking enters here or P5.
- **P5 — Frontier (shapes TBD).** Live webcam mode (product shape
  undecided), model-lift library, VBT→planner suggestions (LV profiles,
  velocity-loss cutoffs), 80–99 % pre-analysed arrivals.

Each phase merges to `main` behind the KinEMOS entry point; premium gating is
a feature flag until auth/billing lands. Long-running KinEMOS work uses a
dedicated `git worktree` (shared-working-tree hazard).

## 13. Open questions

1. **Authoritative metric list** — Simon to supply; replaces §7 placeholder.
2. Literature drop → seeds `kinemos-research` (P4, or earlier if it should
   inform P2's tracker/filter choices).
3. Exact relationship between KinEMOS metric registry and the existing
   Analysis metric registry (merge vs adjacent) — **DECIDED 02/09/2026:
   adjacent, with a read-only adapter.** KinEMOS keeps its own tables
   (`kinemos_analyses.metrics` is the per-rep cache) and its own metric
   definitions (`engine/kinematics.ts`, `engine/phases.ts`); nothing KinEMOS
   is inserted into the Analysis registry's seed. The Analysis module reads
   KinEMOS results through an adapter (`src/kinemos/lib/analysisAdapter.ts`,
   P3b) that projects stored analyses into Analysis facts — athlete,
   exercise, date, metric id, value, plus the grade as a quality flag — so
   trend views and Soll-Ist can chart peak velocity per phase or power next
   to load and volume without the Analysis code importing the engine.
   *Built in 0.84.0 (P3b): `analysisAdapter.ts` projects the records,
   `analysisMetrics.ts` declares the measures, `factFetch` carries the values
   on a KinEMOS fact row that counts nothing towards training totals.*
   Rationale: the engine stays pure (§4 rule 1), the schema needs no
   surgery, and a KinEMOS metric definition can change without a migration
   of Analysis facts. Revisit only if a coach-defined Analysis metric ever
   needs to *combine* a KinEMOS value with a load value inside one formula;
   that is the case an adapter cannot serve.
4. Live-mode product shape (P5) — deliberately open.
5. Retention/cost policy revisit trigger — define a storage threshold that
   forces the raw-video-expiry conversation.
