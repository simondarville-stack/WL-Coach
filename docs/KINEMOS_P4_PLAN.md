# KinEMOS P4 — Intelligence (build plan)

**Parent:** `docs/KINEMOS_DESIGN.md` §12 (P4) and §10 (the flywheel).
**Predecessors:** P0–P3 (`_P0_` … `_P3_PLAN.md`), all shipped.

> **Status: P4a–P4c SHIPPED.** Consent and the labelled-data export (§2), the
> benchmark (§3), zero-click analysis (§4). **P4d — a learned tracker — is
> NOT built, and §5 says plainly why not and what would have to be true
> first.**

The design's P4 is one sentence — *"`kinemos-research` repo: literature,
benchmarking on labelled clips, consented flywheel data collection wired
in-product; ML-assisted detection/tracking (toward zero-click and server-side
pre-analysis)"* — and it contains four separable things with very different
readiness. Three were buildable now. The fourth needs data that does not yet
exist, and pretending otherwise would be the one failure mode this module has
spent four phases avoiding.

---

## 1. What P4 is for, and the order it comes in

The flywheel only turns one way round. A learned tracker needs labelled
frames; the labels worth having are the frames a coach corrected; corrections
only accumulate once the product is worth using; and nobody can tell whether
a learned tracker is better without a benchmark that scores it against the
classical one. So:

1. **Consent** (§2) — nothing may be collected without it, so it comes first.
2. **The benchmark** (§3) — the scoreboard, before there is anything to score.
3. **Zero-click** (§4) — the capability P4 was supposed to need ML for, which
   it turns out P3 already had the parts for.
4. **A learned tracker** (§5) — blocked on the labels the first three
   produce.

---

## 2. P4a — Consent and the flywheel

Design §10: *"consent for training-data use is per-athlete, recorded,
revocable"*.

`kinemos_training_consent` is that sentence as a table, and it keeps
`granted_at` and `revoked_at` **separately** rather than a boolean. Consent
is not an attribute of a person, it is a decision with a date, and a flag
flipped to false cannot say that a bundle exported last March was exported
lawfully. Re-granting after a withdrawal is the later of the two dates
winning, which a boolean also could not express.

`lib/flywheel.ts` holds both halves — the register and the export — and the
export **starts from the consent table**, not from the analyses. That
ordering is the safety property: an athlete who has not granted cannot be
swept in by an oversight in a filter further down the query.

What leaves, and what does not:

| leaves | stays |
| --- | --- |
| the point series as the coach left it, with `s` marking hand-placed points | the video, always |
| the plate calibration, the grade, the bar mass | the athlete's name, id, or anything identifying |
| which clip it came from, so a holder of the footage can pair them | |

Athletes are opaque `subject-<hash>` ids: deterministic, so two exports
agree, and one-way, so the bundle cannot name anyone. The bundle carries an
`about` string explaining itself, because a file that outlives the
conversation that produced it has to.

**Only corrected tracks are exported** (`minCorrections`, default 1). This is
the whole point of design §10's "corrections are the most valuable labels":
a track nobody corrected teaches a tracker what it already believed. A track
the coach fixed says exactly where the current method fails and what the right
answer was.

The register lives on the KinEMOS library, closed by default. A screen that
nags about consent is a screen where consent gets clicked through.

---

## 3. P4b — The benchmark

`verify/bench.mjs`, `npm run bench`. It drives `verify/track-clip.html` — the
harness that already accepts every knob and reports every number — over a
matrix of clips × variants and tabulates. Nothing in it re-implements the
pipeline: a benchmark with its own copy of the engine measures its own copy.

Two kinds of case, answering different questions:

- **Labelled** — the synthetic clip, whose ground truth the harness computes.
  Position RMS in pixels: an absolute number a change makes better or worse.
- **Unlabelled** — real footage, where no truth exists. The measure is
  **agreement**: two views of one lift should give one answer, and a variant
  is better when the gap between them shrinks. This is
  `docs/KINEMOS_ACCURACY_STUDY.md`'s own method, generalised into something
  repeatable.

### What the first run said

The benchmark's first job was to earn trust by reproducing a known result,
and it did:

| pair / variant | Vmax gap % | height gap % |
| --- | --- | --- |
| traek / outline | **2,80** | 2,09 |
| traek / circle-fit | 10,90 | 4,12 |
| traek / default | 12,68 | 6,84 |
| traek / cutoff-6 | 12,68 | 6,84 |

2,80 % is the accuracy study's headline figure, arrived at independently by a
script that knows nothing about that study.

It also surfaced a trade-off nobody had stated. On the synthetic clip the
same `outline` variant is the **worst** of the four by position RMS — 0,709 px
against 0,094 for every other variant — because the synthetic plate is a
drawn disc the template matches perfectly and the outline fit only adds
noise. So:

> Re-centring on the fitted outline **hurts** where the appearance is
> perfect and **helps** where it is not. The synthetic clip's job is to catch
> a broken tracker; it cannot rank variants for real footage, and a variant
> chosen on it alone would have been chosen wrong.

Keeping both kinds of case, and refusing to collapse them into one score, is
the design decision here.

Fixtures that are not checked in are skipped rather than failed — real clips
are somebody's athletes and do not belong in the repository — so the
benchmark runs anywhere and says more where the footage is.

---

## 4. P4c — Zero-click analysis

Design §3 lists zero-click tracking as an explicit v1 **non-goal**, and §12
puts "80–99 % pre-analysed arrivals" in P5 behind a server and a model. Both
were written before P3d and P3g. Finding the plate with no click
(`findPlate`, P3d), following it through a whole set, cutting the set into
reps and calibrating each at its own rest (`trackSet`, P3g) are built and
measured. What separated that from zero clicks was one click — the anchor —
and the plate detector supplies it.

So `lib/autoAnalyse.ts` is the same pipeline the coach drives, driven by
nothing: find the plate on the first frame, take its centre as the anchor,
track the set, split the reps, compute and store all of them. A wand on every
library row runs it; the coach stays on the library and gets a sentence.

**It is not marked as anything a coach approved, and the grade does the
work.** Every rep it writes is graded exactly as a hand-anchored one is —
same tracker tier, same calibration confidence, same peak stability — so an
automatic analysis that went wrong looks wrong. This is the one thing that
makes offering it safe, and it is why zero-click could ship without the ML
tier the design assumed it needed.

`persistRep` is now the single definition of what a stored rep is; the
viewer's TRACK THE SET and the automatic run both go through it, so the two
cannot drift into storing subtly different things.

Still in the browser, not on a server. The design's "server-side
pre-analysis" wants a queue and a headless runner; the capability is now
proven and the plumbing is a deployment question rather than a research one.

---

## 5. P4d — A learned tracker: not built, and why

Design §6.2's tracking tier 3 is *"automatic bar-end/plate detection removes
the anchor click; modern point-trackers (CoTracker/SAM-2-class, exported to
ONNX/WebGPU)"*. It is not built, and this section exists so that nobody has
to re-derive why.

**Three things are missing, and only one is work.**

1. **The labels.** P4a shipped the mechanism; it has collected nothing,
   because consent has not been asked of anybody and the corrected tracks in
   the database number in the tens. A point-tracker fine-tuned on tens of
   reps would learn this gym's lighting.
2. **The evidence that it would win.** The benchmark now exists precisely so
   this can be answered rather than assumed — and the classical tracker's
   current numbers are not obviously beatable: 0,09 px RMS on labelled
   frames, 0,4 px on the marker tier, and two-view agreement of 2,8 %. The
   honest expectation is that a learned tracker helps most where the
   classical one already gives up — a plate lost behind a lifter, a blurred
   second pull — which is a **re-acquisition** problem, and P3g's colour
   re-acquisition addressed the same cases in a few hundred lines with no
   model at all.
3. **A place to run it.** Model weights are tens of megabytes; KinEMOS is a
   client-side SPA whose whole OpenCV payload is already 13 MB and lazily
   loaded. WebGPU inference in the browser is plausible; it is also a
   different deployment story than anything the app does today.

**What would change the answer**, in order of how much it would change it:

- A few hundred consented, corrected reps across several gyms, several
  phones and both lifts — the point at which the benchmark could actually
  distinguish two trackers on real footage.
- A benchmark case that the classical tracker demonstrably fails: today the
  matrix has none, because the cases that used to fail were fixed classically
  in P3e–P3g.
- Lifter pose (design §3's named later phase) — a genuinely different
  capability, needing a model rather than better tracking of one point, and
  the first thing here with no classical alternative.

**The research repository** (`kinemos-research`) is not created. It would
hold literature and training experiments, and it should be created when there
is a labelled set to put in it; an empty repository is a promise, not an
asset. The export in §2 produces exactly the file it would start from.

---

## 6. Out of scope for P4

Everything the design lists under P5: live webcam mode, the model-lift
library, and VBT-driven planner suggestions. Server-side pre-analysis is
listed there too and is now much closer than the design assumed — see §4.
