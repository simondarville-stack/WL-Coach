# KinEMOS P8 — analyse the athlete's upload on the athlete's phone (0.95.0)

**Parent:** `docs/KINEMOS_P5_PLAN.md` §5 (pre-analysed arrivals — the
"server half" that was deferred) and `docs/KINEMOS_P7_PLAN.md` §8 (the one
class of clip the library's sweep cannot reach).
**Built** in a cloud session on `claude/kinemos-athlete-analysis-p8` from
`origin/main` at 0.94.0 (4c93913). No real clips and no phone are in this
environment; §6 is what the local session verifies on one.

## 1. The problem

P5d made a clip analysed by the time the coach sees it, by running the
zero-click pipeline (`lib/autoAnalyse.ts`: activity scan → plate finder →
set tracker → rep cut → `persistRep`) at the two moments a clip is already
in a browser: the coach's import, and the library's sweep. 0.94.0 made the
sweep opportunistic. What neither reaches is the **athlete's own upload**:
the phone posts the file straight to Cloudflare Stream
(`src/lib/streamUploads.ts`, from `uploadLogVideo` in
`src/lib/trainingLogService.ts`), and from then on the clip exists only as
an iframe embed — pixels to look at, not frames to measure
(`LibraryVideo.isEmbed`). The library shows `—` for every one of them and
`unanalysedClips` leaves them out, correctly: no browser can open them.

The obvious answer is a server-side worker. EMOS has nowhere to run one:
it is a client-side SPA on Cloudflare Workers static assets with a single
`/api` Worker (`worker/index.ts`) that brokers Stream and R2, and a Worker
cannot decode video — no WebCodecs, no ffmpeg, a 128 MB heap. §5 designs
and costs what a real one would take, and says why it is not built now.

What works **today**: at upload time the athlete's phone holds the
`File` — the same bytes it is uploading, trimmed by the clip editor if the
athlete trimmed — and iOS 16.4+ Safari and Android Chrome have WebCodecs.
That is exactly the situation the coach's import-time analysis exploits.
So: **run the same pipeline on the athlete's device, from the local file,
right after the row exists**, and store the reps against `source: 'log'`
with the new row's id. The coach's library then shows `2 reps · A` for a
clip nobody's laptop ever touched.

## 2. Decisions

- **The same pipeline, not a lighter one.** `analyseArrival` from
  `lib/arrivals.ts` is called unchanged — scan, find, track, cut, store —
  so a rep analysed on a phone is graded exactly as one analysed on the
  coach's laptop, and the grade says how much to trust it (design §7). A
  phone is slower, not different: the scan is ~20 ms a frame on a laptop
  (P7 plan §7) and the tracker ~150 ms; a 15 s phone clip should take one
  to three minutes on a 2022 phone. That is a number to read in §6, not
  to assume.
- **After the row, never before, never in the way.** The upload completes
  and the strip's spinner clears exactly as today; `uploadLogVideo` is not
  touched. The analysis is queued *after* `uploadLogVideo` returns, from a
  hook on the Today screen (`src/athlete/v2/lib/useUploadAnalysis.ts`),
  and nothing it does can reach the upload: it is fire-and-forget behind
  a `try` that swallows everything, and the pipeline module itself is a
  dynamic `import()` made only then — mediabunny, the engine and OpenCV
  (loaded lazily by the plate finder, ~13 MB the first time) stay out of
  the athlete bundle and off the network until the upload has finished.
- **A gate, as a pure function** (`src/kinemos/lib/deviceGate.ts`,
  `canAnalyseOnDevice(state)`), read from the browser by
  `readDeviceState()` and tested on the struct:

  | Check | Threshold | Why |
  | --- | --- | --- |
  | WebCodecs | `typeof VideoDecoder !== 'undefined'` | The frame server has no other way to decode. iOS < 16.4 and Firefox for Android fail here and the clip is simply not analysed on the phone. |
  | Data saver | `navigator.connection?.saveData === true` → no | The first run downloads OpenCV. Save-data is the one explicit signal the athlete has given about their connection; it is respected even though the clip itself was just uploaded over the same link. |
  | Battery | `level < 0,20` and not charging → no | The brief's threshold. A minute or more of flat-out decoding on a phone at 15 % is how an athlete's phone dies in the gym; at 20 % and above the cost is a few per cent. Absent Battery API (iOS Safari has none) means unknown, and unknown means go — the library's `onPower` makes the same call. |

  The refusal is silent on the phone (nothing to act on) and recorded as
  the gate's `reason` for the hook's tests.
- **A separate, athlete-side preference.** `kinemos.analyseOnImport` is a
  per-coach-browser preference and says nothing about a phone. The phone
  reads `kinemos.analyseOnUpload` from its own `localStorage`
  (`analyseOnUploadEnabled()` in `lib/uploadAnalysis.ts`), default **on**,
  `'off'` to disable. **No UI yet** — the Profile screen is where a toggle
  would go, and it goes there once the phone numbers in §6 say what to
  tell the athlete it costs (COACH-CONFIG candidate: a coach may want to
  turn it off for a whole group on old phones).
- **The bar's mass is the heaviest completed set.** An athlete's upload
  names no set (`uploadLogVideo` is called without `setNumber`), so the
  mass is the heaviest `performed_load` among the log exercise's completed
  sets at upload time — the same rule the library uses to show a load on
  the row (`videoLibrary.ts`, `loadIsTopSet`) — with `massSource:
  'logged'`. No completed set yet (the athlete filmed before logging): no
  mass, and the rep is stored with velocities but no power or force, as an
  unmassed rep is everywhere else. Pure: `massForUpload(sets)`.
- **The owner is the athlete's coach.** `training_log_videos.owner_id` is
  set from `athlete.owner_id` by the Today screen; `persistRep` →
  `ensureAnalysis(…, ownerId)` writes the same id to
  `kinemos_analyses.owner_id`. The rep is owned by whoever owns the clip.
- **One at a time, queued, abandoned on leaving.** The hook holds a
  queue; a second upload waits behind the first (two decoders on one phone
  is how a tab is killed — P5 plan §5). Leaving the Today screen (another
  tab, the coach thread) unmounts the hook, which sets a flag the pipeline
  reads: `shouldStop`, threaded for the first time through the whole
  automatic path — `analyseArrival` → `autoAnalyse` → `scanActivity`
  (already had it) and `trackSet` → `trackDirection` (new,
  `TrackOptions.shouldStop`, checked per frame, ending the pass as
  `stoppedAt: { reason: 'stopped' }`). A stopped run stores **nothing**
  (`AutoAnalyseResult.problem: 'stopped'`); a run that has begun storing
  finishes its few writes — a half-stored set is worse than none (P5 plan
  §5). Scrolling does not unmount anything and does not stop anything.
- **What the athlete sees.** One caption-sized line fixed just above the
  tab bar: "Analysing your lift…" while it runs, then "2 reps analysed"
  for six seconds, then nothing. Failure, no rep found, no plate, the gate
  refusing: silent. The athlete has nothing to do about any of it, and a
  phone that says "no plate found on the first frame" to someone who
  just racked the bar is noise. The coach sees the outcome where it
  matters — the library's Analysis column.
- **Not persisted across a reload.** A queued clip lost to a reload or a
  killed tab is an unanalysed clip, exactly as before this phase; the
  library says `—` and §5's server is the answer for those. Persisting
  the queue would mean holding the file bytes, which is the one thing a
  phone should not do.
- **Storage-path uploads too.** When Stream is off (`VITE_STREAM_UPLOADS`
  unset) the clip goes to the Supabase bucket as a plain MP4 and the
  coach's sweep *could* analyse it later. The phone analyses it anyway:
  the file is in hand, and a rep stored now is a clip the sweep never has
  to download.

## 3. W1 — on the athlete's device

- `engine/tracker.ts`: `TrackOptions.shouldStop`, `TrackStop.reason`
  gains `'stopped'`. `lib/setTracker.ts`: `TrackSetOptions.shouldStop`,
  passed to every piece; a `stopped` piece ends the join loop like a
  `range` stop. `lib/autoAnalyse.ts`: `AutoAnalyseOptions.shouldStop`,
  passed to the scan and the tracker and checked before each stage and
  before storing; `problem: 'stopped'`; `describeAutoAnalysis` says so.
  `lib/arrivals.ts`: `analyseArrival` takes `shouldStop` and passes it on.
- `lib/deviceGate.ts` (new, pure + one reader): `DeviceState`,
  `canAnalyseOnDevice`, `readDeviceState`.
- `lib/uploadAnalysis.ts` (new, pure): the preference, `massForUpload`,
  and `describeUploadOutcome` (the line's text from an outcome).
- `src/athlete/v2/lib/useUploadAnalysis.ts` (new): the queue, the gate,
  the dynamic import, the line's state, unmount → stop. Takes an
  injectable `analyse` for the tests.
- `TodayScreen.tsx`: both `uploadLogVideo` call sites enqueue the file,
  the new row's id and the mass; the line renders above the tab bar.

## 4. W2 — the library and the viewer tell the truth

- Library: `refreshAnalyses` already maps every analysis by clip key with
  nothing filtering embeds out — confirmed, and the map builder is lifted
  into `lib/arrivals.ts` as `summariseAnalyses` so it is tested with an
  embed row (W3). The Analysis column already prefers the stored summary
  to the embed dash. The **Ruler** (open in the viewer) is enabled for an
  embed that has reps; the **wand** and the sweep still skip embeds — they
  cannot open them, and now say why in the tooltip.
- Viewer: `analysable` split in two. A Stream embed opens: the stage shows
  the Stream player (the same iframe `ClipPlayerModal` uses) under one
  plain sentence — "This clip streams from Cloudflare; the reps below were
  analysed on the athlete's phone at upload. Frame-by-frame viewing needs
  the original file." — or, with no reps stored, why there are none. The
  rail (calibration, readout, metrics, grade) already reads the stored
  track, outline and mass and needs no frame server; the analysis panel is
  now shown for an embed too, from the stored series, with no playhead.
  Comparison and trends read stored rows and work; the comparison view's
  side-by-side stage shows "Opening this clip…" for the embed side, which
  is the one rough edge left (the charts and the delta table are the
  point of that view; a note there is a follow-up, not a panel).

## 5. W4 — the server-side alternative: designed and costed, not built

What a real server worker needs on this stack, in order of what exists:

**Trigger.** Stream fires a webhook when a video is ready
(`video.ready`, signed); the `/api` Worker receives it (a new route beside
the direct-upload broker), looks up the `training_log_videos` row by
`storage_path = stream:<uid>`, and enqueues `{ uid, videoId, ownerId,
massKg }` on a Cloudflare Queue. A queue rather than a direct call so a
burst of uploads after a session is worked one at a time and a failed run
retries with backoff; the consumer is the Worker, which starts the job.

**Frames.** Two ways to get them, and this is the whole decision:

- **A — Cloudflare Container** (Node 22 + ffmpeg, `standard` instance:
  ½ vCPU, 4 GiB). Downloads the Stream rendition (downloads must be
  enabled per video — one API call — and yield an MP4 at up to the
  original resolution, re-encoded, not the original bytes: fine for
  tracking, a little softer for the lens tier's edges). ffmpeg decodes to
  raw luma at full size and at 160 px, piped into a Node `FrameSource`
  adapter (`{ frameCount, timestamps, getGray }` — what the tracker
  already consumes through `trackerSourceFrom`) and a `Thumb` feed for
  `engine/activity.ts`. The engine is pure and runs in Node under vitest
  today; `@techstark/opencv-js` runs in Node too, so the plate finder and
  `findPlateOnFrame` need only their frame reads adapted. Persistence
  goes through the same `persistRep` with a service-role Supabase client.
  Port cost: an ffmpeg-backed `FrameServer` (~200 lines), an entry
  script, a Dockerfile. Timing repair (`engine/timing.ts`) still applies
  — ffmpeg's timestamps are the container's.
- **B — Cloudflare Browser Rendering.** A headless Chromium, which has
  WebCodecs, opens a page of the deployed app — `verify/testset.html?
  clip=<url>&auto=1` *is* that page — and the pipeline runs **verbatim**:
  no port, no adapter, the same `openFrameServer`, the same OpenCV chunk.
  The page needs the Stream download URL (a same-origin proxy route on
  the Worker, since the harness fetches the clip) and a way to hand back
  the outcome (the harness already exposes `window.__BENCH__`). Nothing
  in the engine is written twice. The cost is running a browser to do
  arithmetic, and a decoder without hardware acceleration.

**Cost per clip, order of magnitude** (Cloudflare's published rates,
which must be re-read before building; Workers Paid, $5/month, is a
floor for both): a 30 s 1080p60 clip is ~1 800 frames. In Node, ffmpeg
software-decodes that in 5–10 s; the tracker in pure JS is the same code
at the same speed as the browser, ~150 ms a frame inside the lifts —
call it 60–120 s a clip on ½ vCPU. A: ~60 vCPU-s and ~480 GiB-s ≈
**$0,003**. B: ~2 browser-minutes at $0,09 an hour ≈ **$0,003**, after the
10 included hours a month (300 clips). Stream delivery of the download:
0,5 min at $1 per 1 000 min ≈ $0,0005. A club uploading 500 clips a
month costs **about $1,50 plus the plan** either way; the cost is the
engineering, not the metering.

**What it buys.** Phones without WebCodecs (older iOS, Firefox Android);
the athlete's battery and data untouched; retries — a run that failed
because a tab was killed runs again; the **backlog** — every Stream clip
already in the library, which no phone will ever hold again; and coach
uploads from Log mode on a desktop browser that lacks WebCodecs. What it
does not buy: accuracy (the same pipeline, on a re-encoded rendition —
if anything slightly worse than the phone's original bytes) or speed for
the athlete (the phone finishes before the coach looks either way).

**Recommendation: not now.** Ship the device path, and measure for a
month what the library's `—` count for Stream clips does — that number
is the whole case for a server, and today it is a guess. If it stays
high because the athletes' phones cannot decode, or the backlog matters,
build **B first**: a day's work against zero engine duplication, and the
harness page already exists. Build A only if B's software decoding
proves too slow to keep up, or when the pipeline stops being pure enough
to run in a page. Neither is a KinEMOS change; both are Worker changes
that leave `src/kinemos/engine` untouched, which is the point of it
being pure.

## 6. What the local session must verify on a phone

Deploy the branch (or open the dev server on the phone over the LAN;
Stream is off there, so the clip goes to the bucket — that path is
analysed too, §2 last bullet). On an athlete's Today screen in edit mode:

1. **Upload a snatch clip** (the testset double, `VID20250908…`, 60 fps
   HEVC, is the one to use: two lifts, known reps at 1,22 → 2,36 s and
   6,91 → 8,09 s) through Film or Attach on an exercise card with at
   least one completed set logged. The strip's spinner must clear when
   the upload finishes, exactly as before, and the tile must appear.
2. Within a second of that, the line above the tab bar must read
   **"Analysing your lift…"**. Note the time it takes: this is the
   number §2 guesses at one to three minutes. Scrolling must not stop it.
   The first run also downloads OpenCV (~13 MB) — watch for the pause.
3. When it ends the line must read **"2 reps analysed"** for about six
   seconds and then disappear. A single-lift clip says "1 rep analysed".
4. In the coach app, open `/kinemos`: the new row shows **`2 reps · A`**
   (or B) in the Analysis column, the Ruler is enabled, the wand is not.
   Open it: the stage shows the Stream player and the sentence from §4;
   the rail shows the stored metrics (peak velocity ≈ 1,9 m/s on that
   clip) and the grade; the analysis panel draws the series; COMPARE
   opens with the charts and the delta table.
5. **Abandon:** upload again, and tap the Week tab while the line says
   "Analysing your lift…". Come back: the line is gone, and the library
   shows `—` for that clip (nothing half-stored). Check the phone's
   memory did not blow up: Safari's tab must not reload on return.
6. **The gate:** enable Data Saver (Android: Settings → Network → Data
   Saver; iOS: Low Data Mode on the connection) and upload — no line,
   no analysis, the upload as normal. Let the battery fall under 20 % on
   an Android phone unplugged — same. On iOS the Battery API is absent
   and the analysis runs regardless; that is by design (§2).
7. **Two uploads:** attach two clips in one pick. The line stays on
   "Analysing your lift…" through both and the counts arrive one after
   the other; the library shows reps on both rows.
8. **Backgrounding, to observe rather than pass:** lock the phone
   mid-analysis and unlock it a minute later. iOS suspends the tab's
   JavaScript while it is hidden, so the run pauses and resumes; under
   memory pressure Safari reloads the tab and the clip stays `—`. Record
   which happened. If reloads are common, the frame server's cache
   (`openFrameServer`'s `cacheSize`, 24 full-resolution canvases — some
   200 MB on a 1080 × 1920 clip) is the first knob to turn down for the
   phone path; the tracker reads frames in order and barely uses it.

Tests here are synthetic (`npx vitest run src/kinemos src/athlete
src/lib` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the
environment — copy `.env` into the worktree). The phone is where the
timings, the memory and the gate's behaviour on a real Battery API get
read; anything that surprises there belongs in this section as a
number, not as a silenced regression.
