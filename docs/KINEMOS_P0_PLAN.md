# KinEMOS P0 — Pipeline & Library (build plan)

**Parent:** `docs/KINEMOS_DESIGN.md` (locked 01/09/2026). This document scopes
P0 against the codebase as it actually is. Branch: `feature/kinemos-p0`,
built in a dedicated `git worktree`. Ships as a MINOR bump.

> **Status: SHIPPED in 0.78.0.** Two plan assumptions changed during the build
> and are corrected in place below:
>
> 1. **The clip editor already existed.** 0.77.0 landed a shared
>    trim/crop/shrink/split editor (`useClipEditor` + `ClipEditor`, with
>    motion-suggested trim in `clipMotion.ts`) that every upload path passes
>    through. W4 collapsed from "build a trimmer" to "call the existing gate
>    with KinEMOS's limits", and mediabunny — already a dependency — replaced
>    the proposed mp4box.js for both editing and metadata probing.
> 2. **The `/api/*` worker already existed** for Cloudflare Stream brokering,
>    so R2 was an addition to it rather than EMOS's first backend surface.

**P0 promise:** an organised, trimmed, cheap video library — every lift video
in EMOS findable in one dense table, direct import (with lossless trim) for
everything else, storage that scales. Usable and valuable before any tracking
exists.

> **Review addendum (01/09/2026, post-build):** a CV-informed review (OpenCV
> skill + barbell-path-tracker study) landed *after* the P0 build shipped on
> `feature/kinemos-p0` (0.78.0). Items below marked **[retrofit]** were added
> by that review and are follow-up work on the branch — including a follow-up
> migration for the new `kinemos_videos` columns — not part of the 0.78.0
> build. The engine-facing rationale lives in the design doc (§6.2
> implementation note, §6.3 timestamps rule, P1 frame server).

---

## 1. What already exists (P0 builds on, does not duplicate)

| Surface | Storage | Table | Context carried |
| --- | --- | --- | --- |
| Athlete/coach log clips (athlete app, Log mode, Review Feed) | Supabase `log-videos` bucket, or Cloudflare Stream when `VITE_STREAM_UPLOADS=1` (`storage_path = stream:<uid>`) | `training_log_videos` | athlete, log exercise → exercise + date + logged load, set_number, uploader, `owner_id` |
| Competition attempt clips | Supabase `event-videos` bucket | `event_videos` | event, athlete, lift_type, attempt_number |
| `/api/*` Worker | `worker/index.ts` behind `run_worker_first = ["/api/*"]` — currently Stream brokering, inert without secrets | — | — |

Log clips are capped at 60 s at upload — the athlete path is effectively
pre-trimmed already. Existing videos **stay where they are**; P0 migrates
nothing. R2 is for new direct imports only.

## 2. P0 architecture decisions

1. **Library = union, not mirror.** The library reads
   `training_log_videos` ∪ `event_videos` ∪ `kinemos_videos` through one
   service. No row-mirroring of existing sources (nothing to keep in sync);
   `kinemos_videos` holds **direct imports only** in P0. Analysis-state
   records (`kinemos_analyses` etc.) arrive in P1/P2 and reference any source
   polymorphically (`source_kind` + `source_id`).
2. **R2 via bucket binding, not presigned URLs.** The Worker gets a
   `[[r2_buckets]]` binding; upload is a `PUT` of the file body through
   `/api/kinemos/video/<key>`, playback is a `GET` with **Range support**
   (scrubbing depends on it) and immutable cache headers. No S3 keys anywhere.
   Worker body-size limits (plan-dependent, ≥100 MB) sit far above the client
   cap.
3. **Reuse the shared clip editor, at Original resolution.** KinEMOS calls
   `useClipEditor` with `maxSeconds: null` (long-form footage is the point)
   and `allowSplit: true` (one recording of six attempts becomes six rows).
   mediabunny already keeps a trim-only edit on a lossless packet-copy path;
   a crop or a resize forces a transcode, which is why the resolution default
   stays **Original** here. Spatial resolution *is* analysis accuracy — at a
   45 cm plate across ~200 px one pixel is ~2 mm — so shrinking, right for a
   review clip, is wrong for footage headed to measurement. The editor still
   offers it; nothing nudges the coach there.
4. **Direct-import caps:** 300 MB (`KINEMOS_IMPORT_MAX_BYTES`, mirrored
   worker-side, `// COACH-CONFIG candidate`), deliberately looser than the
   200 MB Supabase buckets, and no duration cap at all — competition floor
   footage and multi-rep sets are the direct-import use case.
5. **No new feature flag.** `/kinemos` is a lazy chunk with a coach-side
   sidebar entry; the existing coach gate applies. Premium entitlement waits
   for the auth/billing phase, per the design doc.

## 3. Work breakdown (build order)

### W1 — R2 plumbing (worker + wrangler)

- Create R2 bucket `emos-kinemos-videos`; add binding `KINEMOS_VIDEOS` to
  `wrangler.toml`.
- `worker/index.ts` routes (same inert-until-ready philosophy as Stream —
  503 if the binding is absent):
  - `PUT /api/kinemos/video/<key>` — validate key shape
    (`<ownerId>/<uuid>.<ext>`, allow-listed extensions) and size, stream body
    to R2 with content-type.
  - `GET /api/kinemos/video/<key>` — R2 get honouring `Range`, `etag`,
    `cache-control: immutable` (keys are content-addressed-by-uuid, never
    rewritten).
  - `DELETE /api/kinemos/video/<key>` — idempotent (404 counts as gone).
- **[retrofit] Abuse hardening (no-auth phase):** a public `PUT` is a free-storage-dump
  vector and `DELETE` is destructive against guessable-shape keys. Cheap
  mitigations now: shared header token baked into the bundle (weak, but
  filters drive-bys), Worker-side per-key size cap + content-type check, and
  honour `DELETE` only for keys the client can name from an existing row.
  Real auth replaces this in the auth/billing phase.
- Dev workflow: `/api` does not exist under plain `vite dev` — add a Vite
  `server.proxy` entry forwarding `/api` to `wrangler dev` (documented in the
  worker header), same story the Stream path already lives with.

### W2 — Migration: `kinemos_videos`

Direct-import registry (applied via Supabase MCP, captured as a migration):
`id`, `owner_id`, `athlete_id?`, `exercise_id?`, `r2_key`, `duration_s`,
`fps_avg?` + `vfr` (bool), `width?`, `height?`, `rotation?`, `codec?`,
`device_make?`, `device_model?`,
`trimmed` (bool) + `original_duration_s?` (trim provenance), `recorded_at?`,
`note?`, `created_at`/`updated_at`. Both athlete and exercise nullable —
unattached videos are first-class (design §5.2).

**[retrofit — follow-up migration]** `fps_avg`/`vfr`, `rotation`, `codec`
were added by the post-build review; the applied `20260901120000` migration
predates them. Three columns exist for the P2 engine, not for P0 UI — cheap
to probe now
(mp4box.js already has the file open), expensive to backfill later:

- **`vfr`** — phone video (iPhone especially) is often variable frame rate.
  Velocity is dx/dt; a single nominal fps on a VFR clip silently corrupts
  every velocity/power number, and the Butterworth filter (design §6.3)
  assumes uniform sampling. mp4box's sample table answers this directly;
  the engine works on per-frame timestamps (WebCodecs supplies them), and
  the quality grade docks VFR clips.
- **`rotation`** — portrait phone video is stored landscape with a rotation
  matrix in the container; naive width/height are swapped vs playback, and
  WebCodecs decodes *unrotated* frames, so the engine needs the matrix to
  map clicks to pixels. Lossless trim preserves it, so it stays true.
- **`codec`** — iPhone defaults to HEVC; decode support (both `<video>` and
  WebCodecs) varies by browser/OS. Extension allow-listing says nothing
  about the codec inside the container.

### W3 — Service layer: `src/kinemos/lib/videoLibrary.ts`

- `listLibrary(filters, paging)` — union of the three sources into one
  `LibraryVideo` shape: source badge (`log` / `event` / `direct`), athlete,
  exercise, date, load (from the log exercise where available), duration,
  thumbnail, playback URL, source deep-link. Filters: athlete, exercise,
  source, date range, unattached-only.
  **[retrofit]** Answering the CV review's open question: 0.78.0 does *not*
  page the union. It reads all three sources in full (`fetchAllRows` per
  source, which pages each one) and then filters and sorts in memory — fine
  at a season of footage, wrong once the library outgrows a single read.
  The fix when it does: keyset pagination on `created_at` — fetch `limit`
  from each source with `created_at < cursor`, merge-sort, take `limit`.
- `importDirectVideo(file, meta)` (`directImport.ts`) — probe → `PUT` to R2 →
  poster → insert row; deletes the R2 objects on a failed row insert, the
  cleanup contract the Stream path established.
  **[retrofit]** Check decodability at import
  (`VideoDecoder.isConfigSupported` / `MediaSource.isTypeSupported`) and
  refuse an undecodable clip with a message rather than creating a dead
  library row — iPhone defaults to HEVC and support varies by browser/OS.
- `deleteDirectVideo` — row first, then bytes (a row outliving its bytes shows
  a broken tile; bytes outliving their row are invisible).
- `probeClip` (`kinemosProbe.ts`) — duration, fps, display dimensions, and
  device make/model from container metadata, via mediabunny behind a dynamic
  import. Every field optional, every failure silent.
  **[retrofit]** Also record average fps + a VFR flag, rotation and codec —
  the engine works on per-frame timestamps rather than frame indices, so VFR
  has to be visible. Needs the follow-up migration noted in W2.
- Thumbnail: `captureVideoPoster` (already extracted to `videoProbe.ts` by the
  0.77.0 work) → R2 beside the clip as `<uuid>.jpg`.

**No new dependency.** mediabunny (MPL-2.0) arrived with the 0.77.0 clip
editor and covers both editing and probing, so the proposed mp4box.js is not
needed.

### W4 — Import control (reuses the shared clip editor)

`ImportControl`: optional athlete + exercise attach (both may stay empty —
unattached footage is first-class), then a file pick that hands off to
`useClipEditor`. The editor supplies trimming, cropping, resolution and the
motion-suggested lift window; KinEMOS only supplies the limits and consumes
the resulting file list.

- **[retrofit] Snap handles to keyframes.** A keyframe-aligned cut lands the real
  in-point at the previous keyframe, earlier than a free-floating handle
  shows. mp4box exposes the sync-sample table — snap the UI handle to it so
  what the coach sees is what they get.
- **[retrofit] The MB cap binds before the minutes cap** on high-bitrate footage
  (3 min of 4K60 easily exceeds 300 MB — exactly the competition-floor
  use case). The readout treats the size cap as the binding constraint and
  says so, instead of rejecting after the trim.

### W5 — Library UI + route

- Lazy `/kinemos` route + sidebar entry; all KinEMOS code splits into its own
  chunk (design §4 rule 2 — main bundle must not grow; check the build
  report).
- Dense EMOS-style table (`StandardPage`, tokens, `formatDateShort`):
  thumbnail, athlete, exercise, date (DD/MM), load, source badge, duration,
  actions — play (lightbox), open source (log entry / event), delete
  (direct imports only in P0; log/event clips are deleted where they live).
- Filter bar per W3; default sort newest-first.
- "Analysed / grade" column ships as a placeholder — it lights up in P2.

### W6 — Cross-links from existing surfaces

"KinEMOS" chip on Review Feed video cards, beside the technique rating:
navigates to `/kinemos?clip=log:<video id>`, and the library focuses that one
row (a focused clip overrides the filter bar, so arriving from the reel can
never land on an empty table). P1 retargets the same gesture at the analysis
viewer. The planner `VideoLightbox` / `LogVideoStrip` entry points are still
open.

### W7 — Verify & ship

Done, and what was actually exercised:

- `npm run typecheck` clean; 729 tests pass (48 files), including 16 new ones
  covering key generation against the worker's validator and the library's
  filter semantics.
- `npm run build`: KinEMOS is its own 17 kB chunk, mediabunny stays a separate
  567 kB chunk loaded only when the editor or probe runs.
- Worker R2 routes exercised against `wrangler dev` with a local bucket:
  PUT → 200, GET → 200, `Range: bytes=5-14` → 206 with a correct
  `Content-Range`, suffix `bytes=-9` → 206, malformed key → 400, DELETE twice
  → 200 both times, GET after delete → 404.
- Full import round-trip in the running app with a real MP4: clip editor
  opened at Original resolution → import → probe stored 2,96 s / 29,05 fps /
  320×240 → clip and poster PUT to R2 → row rendered in the library →
  playback served as **206 Partial Content** (the browser range-seeks, which
  is what P1's scrubbing depends on) → delete removed the row and both
  objects.
- Review-feed chip navigates to the library focused on the intended clip.

## 4. Known edges (accepted in P0)

- **Stream-hosted log clips** (`storage_path = stream:<uid>`) play via iframe
  and appear in the library, but Stream re-encodes and does not expose the
  original file by default. Analysis (P1+) needs real frames — resolution
  deferred to P1: enable Stream MP4 downloads per-clip via API, or accept a
  quality-grade penalty on Stream-sourced analyses. Recorded here so P1
  scopes it, not discovers it.
- **The R2 bucket must exist before the first deploy**
  (`wrangler r2 bucket create emos-kinemos-videos`). Until it does, the
  `/api/kinemos/*` routes answer 503 and import reports storage as
  unconfigured; nothing else in the app is affected.
- **Interim object access.** An R2 key is a v4 UUID and therefore the
  capability — the same model as the public Supabase video buckets the app
  already serves from. `owner_id` is on the row so the auth/RLS phase can put
  a real check in front of the routes without moving an object.
- **Two vestigial columns.** `training_log_videos.performed_load` and
  `.performed_reps` exist in the database, appear in no migration, are read by
  no code, and are empty on all 7 rows. The library derives load from
  `training_log_sets` instead. Left in place per the deletion policy — worth a
  decision, not a silent drop.
- Inbox/chat video messages are not part of the P0 union — a later source if
  wanted.
- No retention automation (design: keep until manual delete / space forces
  the conversation).
- No athlete-side trimmer: the 60 s log cap already bounds that path; the
  trimmer ships on the coach import path where the long files are.

## 5. Out of scope for P0

Viewer, calibration, tracking, metrics, phases, annotations, sharing,
talkovers, comparison — P1+ per the design doc. P0 ends with a coach looking
at one table that finally contains every lift video they have.
