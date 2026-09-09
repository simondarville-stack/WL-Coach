# KinEMOS P9 — Lift families: the clean, the jerk, the pulls, and the lift nobody named

**Status:** framework draft v2, 09/09/2026 — revised against the sources in
`KinEMOS Resources/` (§0). For discussion before anything is built; §11
lists what is still the coach's to decide. Nothing in §5 is locked.
**Parent:** `docs/KINEMOS_DESIGN.md` §7 (phases are coach-configurable data),
§12 (P5 named "shapes TBD"), §13 Q1 (the authoritative metric list — now
supplied, see §0).
**Predecessors:** P0–P8. The coach-config pass is filed in `EMOS_TO_DO.md`
and follows this phase.

## 0. The sources, and what each one settled

`KinEMOS Resources/` (repo root, **kept out of git** — 374 MB of video):

| Source | What it is | What it settles here |
| --- | --- | --- |
| `BVDG_Rahmentrainingskonzeption_2019.pdf` §4.4 (pp. 59–70), §6.3.2 (pp. 104–107), Anhang A6–A8, Tab. A1–A3 | The German federation's framework: the phase structure of snatch, clean and jerk after Knoll & Sandau (2018); the Realanalyzer method; the target curves; the reference values per weight class | **Phase names and delimiting events** (§3.2), **reference bands** (§6), and a validation of KinEMOS's own method (§7) |
| `german_weightlifting_technical_data.zip` — `Parameter1–4`, `orientierungswerte1–3`, `*_ges`, `tl_*` | The Weightlifting Analyzer's parameter definitions for snatch/clean and for the jerk, the reference tables, the four target curves (path, velocity, force, power against height), the phase picture series | **The jerk's metric set** (§5.5) and the exact definitions of the snatch/clean set already in `AnalyzerMetrics` |
| Posters `plakat_a1_ausstossen`, `csm_plakat_a4_reissen/umsetzen`; `Screenshot__39_` | *Gewichtheben in Perfektion* — six-position technique posters with joint angles; the six jerk positions | The **body-event** boundaries that a plate cannot measure (§9), and the dip depth 17–22 cm |
| `MeasurementSystemsReport.pdf` (Darville 2018, DTU) | Characterisation of the three motions; the measures of interest translated to English (Fig. 8 snatch/clean, Fig. 10 jerk); accuracy and resolution requirements; interviews (Sandau, Käks, Munk) | The English names for the jerk parameters, the **S_drive − S_asc ≥ 3–4 cm** resolution target, and which measures each user group actually wants |
| `EXAMPLE_OLD_VIDEO_SOFTWARE.jpg` | The Analyzer's screen: bar path left, velocity against height right | KinEMOS's bar-path column already matches this (0.96.0); the missing halves are force and power against height (§5.6) |
| `Testvideos/` — 100 clips, 2009, WMV, 384 × 288, 50 fps, 3–10 s, Danish names, three views each | A complete taxonomy of training exercises on film: snatch, clean, jerk, push press, pulls, deadlifts, squats, snatch balance, from hang/blocks | **The testset for the shape and phase rules** (§8), and the vocabulary the exercise mapping must understand (§4) |

Design §13 open question 1 — "authoritative metric list, Simon to supply" —
is answered by these files. The Analyzer's snatch/clean set was already
built in P3f; the jerk set (§5.5) and the reference bands (§6) are new.

## 1. Where the model stands today

KinEMOS analyses every clip as a snatch from the floor, and calls it a
default. Concretely (from the code, 09/09/2026):

- **The exercise is a label.** `LibraryVideo.exerciseName` is a string;
  no rule, metric or rep cut reads it (`lib/videoLibrary.ts:43`,
  `comparisonService.ts:92`, `referenceService.ts:20`). A competition
  attempt has no exercise at all and is named `"Snatch 3"` on the fly.
- **One phase set exists**, `DEFAULT_PHASE_SET` (`engine/phases.ts:106`):
  first pull → transition → second pull → turnover → catch, ending at
  `settle`. `proposePhases` takes the set as a parameter, so the seam is
  there; every call site passes nothing and every stored analysis says
  `phase_set_id = 'default'` (`autoAnalyse.ts:97`, `KinemosViewer.tsx:791`).
- **The rep cutter assumes a bar that rests low and rises**
  (`engine/reps.ts`): a rest is a still run *near the local floor*; a rep is
  the first rise from it past a minimum height; the catch is where it stops
  rising; 2 m/s downward is a drop. A jerk — bar resting high, moving
  *down* first 17–22 cm, rising, caught overhead — has no rest the cutter
  recognises and no rise it would believe.
- **Live mode** is the same shape as a state machine: WAITING near the floor
  → RISING → SETTLING (`engine/liveReps.ts`).
- **The metric catalogue is exercise-agnostic** and phase-keyed: `firstPull`
  reads `phase(m, 'first_pull')`, the Analyzer's measures need
  `first_pull / transition / second_pull / catch` and are null without them
  (`engine/metricCatalogue.ts`, `AnalyzerMetrics`). Null is already the
  right answer for a missing phase; nothing yet *hides* a metric that a
  lift cannot have, so a deadlift would show a "Turnover" row of dashes.
- **Comparison** aligns on lift-off, peak velocity or apex
  (`engine/compare.ts:41`) and warns when two analyses carry different
  phase-set ids; nothing stops a snatch being laid over a jerk.
- **EMOS already classifies lifts**, outside KinEMOS: `exercises.lift_slot`
  (`snatch | clean_and_jerk | front_squat | back_squat | snatch_pull |
  clean_pull`, one exercise per slot), the parent-child exercise tree, and
  the Soll-Ist resolution ladder (`sollIstPresets.ts:201` — slot → exact
  name → coach-taught alias → prefix → substring, with German **and
  Danish** name candidates). None of it crosses into `src/kinemos/`.

So the good news: phases are data, the catalogue is data, the phase-set id
is stored, and the exercise mapping machinery exists. The work is to give
those seams something to carry, and to teach the engine one motion it has
never seen — the dip-and-drive.

## 2. What the coach is asking for

Four groups, and a fifth that was implicit — and the 2009 archive (§8)
films every one of them:

| Group | Examples (Danish names in the archive) | What the bar does |
| --- | --- | --- |
| **Unspecified** | squats (*Ben foran / bagpå*), presses, anything without a catalogue entry | rests, moves, rests — no phases; universal metrics only |
| **Snatch family** | snatch (*Træk*), power snatch (*Power pull*), muscle snatch (*Power pull strict*, *Råtræk*), snatch pull (*Trækhiv*), snatch deadlift (*Styrketræk*), from hang / deep hang / blocks / low and high blocks / above the knee (*fra hæng, dyb hæng, blok, lav/høj blok, overgang*), snatch balance (*Balancetræk*) | rises from a rest, is caught (or not), from the floor or from a height |
| **Clean family** | clean (*Stødvend*), power clean (*Power pull stød*, *Frivend*), clean pull (*Stødhiv*), from positions | the same motion, narrower grip, lower catch |
| **Jerk family** | jerk (*Opadstød*), push jerk / power jerk (*Knickstød*), push press (*Push pres*), press (*Stem*) | rests high, **dips**, brakes, drives, flies, is caught (or pressed) overhead |
| **Compound** | clean & jerk (*Stød*) as filmed in competition and in training | a clean, a rest at the rack, a jerk — two shapes in one clip |

"The list is not limited to this" is the design constraint: the framework
must let a coach add *snatch balance* or *hang power clean from blocks*
without a code change, which is CLAUDE.md principle 1 said plainly.

## 3. The framework: a lift model in three layers

The mistake to avoid is one enum of lift names with rules welded to each.
Instead, a **lift model** is data composed from three layers that change at
very different rates:

### 3.1 Motion shape — what the bar does (engine's business, closed set)

The engine needs to know only the *physical signature* of a rep, and there
are few of those. Proposed set, `MotionShape`:

| Shape | Rest | Signature | Ends at | Examples |
| --- | --- | --- | --- | --- |
| `pull-catch` | low, still | rise → apex → drop under → catch below apex → settle | settle | snatch, clean, power variants, muscle snatch (catch depth ≈ 0) |
| `pull` | low, still | rise → apex → lowered or dropped, **no catch read** | apex | pulls, high pulls, deadlifts, shrugs |
| `dip-drive` | high, still | **descent** → lower turning point → rise → apex → catch or press-out → settle | settle | jerks, push press, push jerk, (press: descent ≈ 0) |
| `free` | any still run | movement between two rests | next rest | the unspecified lift |

Shape decides three things the engine does before any phase is named:
**how a rep is cut** (§5.3), **which boundary rules are meaningful**, and
**what the alignment anchors for comparison are**. Adding a shape is engine
work and should be rare; the four above cover every exercise in the
archive, and the Darville report's own characterisation (§2.5: the jerk is
"a straighter up and down movement", the clean "the same flattened S as
the snatch, lower and with a longer drop") says the same.

### 3.2 Phase set — how the coach divides the shape (coach-configurable data)

Exactly the existing `PhaseDefinition[]` mechanism, one default set per
family, all editable later by the coach-config pass. **The defaults take
the BVDG names and events** (RTK 2019 §4.4, after Knoll & Sandau 2018),
because that is the vocabulary the reference values and the target curves
are stated in, and the coach can rename them. English labels in the UI,
the German term in the tooltip.

**Snatch and clean from the floor** — the BVDG model is four movement
phases, the first of which has three parts:

| Phase (BVDG) | KinEMOS id | Starts at | Bar event? |
| --- | --- | --- | --- |
| 1. Zugphase | `first_pull` | lift-off | yes (`liftoff`) — ends "just above the knee" |
| Kniepassage | `transition` | end of first pull | **body event**; approximated by the first velocity peak / acceleration trough, as today — the RTK itself defines its *end* by the bar: v2, the velocity minimum |
| 2. Zugphase | `second_pull` | end of knee passage | yes (`velocity-trough`) — ends at the **vmax position** (full extension) |
| Umgruppieren | `turnover` | vmax | yes (`peak-velocity`); unsupported ~0,10–0,11 s |
| Abbremsen | `catch` | bar lands on the arms / shoulders in the half squat | approximated by `apex`; ends at the lowest point of the sit, ~15 cm of braking in the clean |
| Aufstehen | *(not a phase today)* | lowest point | yes (the sit); ends at `settle` |

This is the existing five-phase set with its names confirmed. Two
adjustments are worth making: the catch's end (`settle`) is where the
bar is still again *after standing up*; the BVDG's Abbremsen ends at the
**sit** (s_Sitz), and Aufstehen follows. Splitting `catch` into
`catch` (apex → sit) and `recovery` (sit → settle) makes S_sit, S_fall
and F_br read from a phase rather than from a search, and makes
"recovery" available as a phase metric (a clean's stand-up is coached).

**Snatch and clean from the hang or blocks** — the RTK defines the first
pull as *lift-off to just above the knee*. A lift from above the knee
therefore **has no first pull and no knee passage** — the set is
`second_pull → turnover → catch (→ recovery)`, and `findLiftoff` already
returns the hang as lift-off. A lift from below the knee (deep hang, low
blocks) keeps `transition` and `second_pull` but has no first pull. So
three from-position sets, chosen by the model, none of them inventing an
edge.

**Pulls and deadlifts** — the acceleration phases only, ending at
`apex`. A deadlift is one phase, lift-off to apex. The Analyzer's pull
measures (v1, v2, vmax, s_ZH, F1–F3) all read; the turnover ones are
absent by construction.

**Jerks** — the BVDG model, four movement phases, the first with two
parts, and every boundary readable from the bar:

| Phase (BVDG) | KinEMOS id | Starts at (rule) | Ends at | Reference |
| --- | --- | --- | --- | --- |
| Auftakt | `dip` | `dip-start` — first sustained descent from the high rest (s_Start) | the lower turning point s_u | 17–22 cm, 0,45–0,50 s; ⅔ of the way brisk, the lower third is the braking; v_Auft 0,8–1,2 m/s |
| Anstoß | `drive` | `dip-bottom` — s_u, velocity crosses zero upward | the vmax position | ~0,25 s; δ_Stoß is 3–4 cm longer than δ_Auf |
| Umgruppieren | `turnover` | `peak-velocity` | the upper turning point s_o | feet unsupported ~0,1 s; δ_Tr = s_o − s_vmax |
| Abbremsen | `catch` | `apex` (s_o) | the bar fixed in the split, s_Ausf | δ_Ab 2–6 cm, the drop the arms allow |
| Aufstehen | `recovery` | the bar fixed (velocity minimum passed, still) | `settle` | the two-step recovery; the bar barely moves |

The braking third of the dip is a *sub-phase* the Analyzer does not name
but measures (F_Auf is its peak force, δv_Auf the distance to v_Auft);
`peak-downward-velocity` is offered as a rule so a coach who wants
"Auftakt / Bremsen / Anstoß" can have it. A push press has the same set
with `catch` reading a drop of about zero; a press has a dip of about
zero and is better served as `unspecified`.

**Unspecified** — no phase set. The engine skips `proposePhases`
altogether rather than proposing five fallback edges.

### 3.3 Metric set — what gets read (catalogue data, gated by shape and phases)

The catalogue stays one list; each definition gains a **requirement**:

```ts
requires?: { shape?: MotionShape[]; phases?: string[] }
```

A surface lists a metric only when the lift's model satisfies it; an
unsatisfied metric is *absent*, not a dash. Today's phase-keyed metrics
declare `phases: ['first_pull']` and so on; the Analyzer's snatch/clean
measures declare the four phases they need; the universal ones declare
nothing.

**Universal metrics** (the unspecified lift's whole set, and the base of
every other) — several exist in `RepSummary` already and are simply not
in the catalogue:

- duration of the concentric (rest → apex) and of the whole rep (rest → settle)
- peak velocity, **mean velocity of the rise**, mean propulsive velocity
- **time to peak velocity** and **time to peak power** (from lift-off)
- peak power, mean propulsive power (both need a mass), and p_SK
  (load × vmax, the Analyzer's "Schnellkraft-Leistung") which needs no
  phase at all
- displacement (apex − start), path length, loop width
- a **velocity profile** — the curve itself, which the analysis panel and
  the comparison already draw; "velocity at height" per 10 cm as a table
  is a cheap addition the trends view could chart

**Jerk metrics** — the Analyzer's set, §5.5.

**Family-specific expectations** — a power snatch is a snatch whose catch
is high, a muscle snatch one whose drop-under is nil. These are *the same
model with different expected values*, not different phase sets. The
model carries an `expects` block (§6) that the verdict and the shape check
(§5.4) read, and it is COACH-CONFIG from day one.

### 3.4 The registry

```ts
interface LiftModel {
  id: string;            // 'snatch', 'snatch-hang-above-knee', 'clean-pull', 'jerk', 'unspecified', …
  family: 'snatch' | 'clean' | 'jerk' | 'none';   // for grouping and trends
  label: string;
  shape: MotionShape;
  phaseSet: PhaseDefinition[] | null;
  endRule: BoundaryRuleId | null;
  thresholds?: Partial<PhaseThresholds>;          // per-model overrides
  expects?: ReferenceBands;                       // §6, per weight class and sex
}
```

The registry lives in the engine as data (`engine/liftModels.ts`), with the
built-in models as defaults and — after the coach-config pass — coach
overrides stored per owner. The **id is what an analysis stores**
(§5.2), so a reader always knows which model segmented a rep, the same
reason `phase_set_id` exists.

## 4. Mapping an exercise to a model

Declared, not guessed; guessed only as a proposal. The resolution ladder,
in the order EMOS already uses elsewhere:

1. **The exercise's own field** — `exercises.kinemos_lift_model` (new,
   nullable text, the model id). Set by the coach on the exercise; that is
   the one place the mapping lives.
2. **The parent's** — a child in the exercise tree without a model uses its
   parent's ("Snatch from blocks" under "Snatch"), the same inheritance the
   tree already gives PRs. A child whose *name* says "hang", "blocks" or
   "knee" refines the parent's model to the from-position variant.
3. **`lift_slot`** — `snatch` → snatch, `snatch_pull` → snatch pull,
   `clean_pull` → clean pull, `clean_and_jerk` → the **compound** (§5.3);
   squats → unspecified.
4. **Name heuristics**, the Soll-Ist ladder's keyword tier, extended with
   the archive's Danish vocabulary and the RTK's German: *jerk / Ausstoßen /
   opadstød / knickstød / push press / push pres* → jerk family; *pull /
   hiv / Zug / deadlift / styrketræk* → pull shape; *snatch / Reißen / træk*
   and *clean / Umsetzen / vend* → the family; *hang / hæng / blok / block /
   knee / overgang* → from-position; *power / fri* → power variant; *strict /
   muscle / rå* → muscle variant. Proposed to the coach on the exercise,
   never silently applied to an analysis without being shown.
5. **Competition videos** — `lift_type` is authoritative: `snatch`,
   `clean_jerk` → compound.
6. **Nothing** — `unspecified`. Honest, and still gives the universal set.

The **analysis stores the resolved model** and the coach can override it
per analysis in the viewer (a chip beside the grade: "Snatch · from floor
▾"). Re-segmenting under another model is a recompute, which the 0.84.0
recompute path already does for metrics.

## 5. What has to change in the engine

### 5.1 Nothing, for most of the snatch and clean families

Snatch, clean, power variants, pulls, deadlifts and from-position lifts
segment today with the *existing* rules by choosing a phase set and an end
rule. The pull's end at `apex`, the from-position sets and the
`catch`/`recovery` split are new data plus one rule (`sit`, the lowest
point after apex — which `computeAnalyzerMetrics` already finds for
S_sit). This is why §10 puts them first.

### 5.2 Storage — two additive migrations

- `exercises.kinemos_lift_model text null` — the coach's declaration.
- `kinemos_analyses.lift_model_id text null` — what segmented this rep;
  null on existing rows means the five-phase snatch/clean model, which is
  what they were all analysed under. `phase_set_id` stays and keeps
  meaning "which phase set", now derived from the model.

### 5.3 Rep cutting by shape

`splitReps` becomes shape-aware. The still-run detection stays; the
*floor-band* test (rest must sit near the lowest height) becomes a shape
rule:

- `pull-catch`, `pull`: as today.
- `dip-drive`: a rest is a still run at any height; a rep is a descent of
  at least `minDipCm` (10 by default — the references say 16–22)
  followed by a rise past the rest height by at least `minRiseCm`; it
  ends at the next still run.
- `free`: a rep is any movement between two still runs that exceeds a
  minimum displacement.
- **Compound (clean & jerk):** cut on *every* still run, then classify each
  segment by what comes first — a rise from a low rest is the clean, a dip
  from a high rest is the jerk. The clean's settle at the rack **is** the
  jerk's rest; the RTK says a lifter may lift and re-seat the bar there,
  which must not read as a rep (`minDipCm` and `minRiseCm` both guard
  it), and the rest itself may be short — `restMinS` for a high rest is a
  testset question (§8). The compound yields two reps with two models
  under consecutive rep indices, and the viewer's rep picker shows them
  as "Clean" and "Jerk" rather than "Rep 1 / Rep 2". The Darville report
  §2.5 asked for exactly this: "the system should be able to distinguish
  between the two parts of the lift".

Also `stopAtDrop` in the tracker: a jerk is dropped from overhead, so the
2 m/s rule still ends the track correctly; a push press is lowered, and a
pull is lowered — no change.

### 5.4 The shape check

The model is declared; the engine **checks the track against it** and says
so when they disagree: a track declared *jerk* whose first movement is a
rise from a low rest reads "this looks like a pull from the floor, not a
jerk — the exercise on this clip may be wrong", with a one-click switch.
The same classifier gives the *unspecified* lift a proposal ("looks like a
pull and catch") that the coach can accept to unlock the family metrics.
Inferred, never silently applied — the honesty rule from the grade.

### 5.5 The jerk's measures

The Analyzer's jerk set (`Parameter1–2`; English names from the Darville
report Fig. 10), as `JerkAnalyzerMetrics` beside `AnalyzerMetrics`, null
without the jerk phases:

| Symbol | KinEMOS field | Definition | Unit |
| --- | --- | --- | --- |
| p_SK | `pskNs` | load × vmax | N·s |
| v_Auft | `vDipMs` | peak **downward** velocity in the dip (V_asc in the report) | m/s |
| v_max | `vmaxMs` | peak upward velocity, at the end of the drive | m/s |
| v_min | `vminMs` | lowest velocity after the upper turning point — the drop into the split | m/s |
| δ_Auf | `sDipCm` | dip depth, s_Start − s_u (S_asc) | cm |
| δv_Auf | `sToVDipCm` | distance from the start to where v_Auft occurs (S_Vasc), ≈ 10 cm | cm |
| δ_Stoß | `sDriveCm` | drive path, s_u → s_vmax (S_drive), 3–4 cm longer than δ_Auf | cm |
| δ_Tr | `sFlyCm` | s_o − s_vmax, the rise after peak velocity (S_fly) | cm |
| δ_Ab | `sFallCm` | s_o − s_Ausf, the drop to the fix (S_break) | cm |
| F_Auf | `fDipPct` | peak vertical force in the dip's braking, % of load, ≈ 180 % | % |
| F_Stoß | `fDrivePct` | peak vertical force in the drive (first third), 180–190 % with two maxima, 220–230 % with one | % |
| F_br | `fbrPct` | peak vertical force braking the bar overhead, 125–130 % | % |
| s_Rest | `sRemainPct` | the share of the rise after vmax not explained by vmax²/2g, 60–80 % | % |
| t_Umgr | `tTurnS` | vmax → vmin, ≈ 330 ms | s |

All are functions of `yCm`, `vyMs` and the force-percentage series
`forcePercentOf` already computes; none needs a mass except p_SK. Two
derived numbers the report's requirements single out: **δ_Stoß − δ_Auf**
(the "3–4 cm" the sports scientist wants to test, the "yes/no" the coach
wants), and the count of force maxima in the drive (the RTK's "possibly
two maxima" for the clean's braking and the jerk's drive) — the latter is
a curve-shape reading and belongs with §5.6, not the table.

The report's resolution target for that difference — position steps of
**1 cm** — is met on the everyday tier already (design §6.4; the accuracy
study measured ±4 % of a 45 cm plate at worst).

### 5.6 The target curves (Sollverläufe)

The Analyzer shows four curves against bar height — path, velocity,
**force** and **power** — and the RTK's appendix A6–A8 gives the target
shape of each for the three lifts. KinEMOS draws the first two
(`BarPathPanel`, 0.96.0). Adding force (% of load) and power against
height is a plot-only change over series the engine already has, and it
gives the coach the picture the German material teaches from: two force
maxima in the drive, W_Rest as the area above vmax. The **model-lift
library** (0.88.0) is where a club's own Sollverlauf lives; a coach who
wants the BVDG's target curve as an overlay can mark one exemplary lift.

### 5.7 Comparison and trends

- **Same shape or refused.** Snatch vs clean: allowed, same shape, caveat
  shown. Snatch vs jerk: refused with the reason. Family-specific metrics
  drop out of the delta table when either side lacks them.
- **Alignment anchors per shape:** `pull-*` keep lift-off / peak velocity
  / apex; `dip-drive` gets dip-start, dip-bottom, peak velocity, apex.
- **Trends** are per exercise already; the family lets "second-pull peak
  velocity across all snatch variants" be one line and stops a jerk's
  peak velocity landing in a snatch trend.
- **The reference lift and the model-lift library** are per exercise
  already and need nothing but the same-shape guard.

### 5.8 Live mode

A second state machine for `dip-drive` (WAITING high → DIPPING → RISING →
SETTLING) and a shape choice on the live screen. Later slice; live mode
has not run against a camera yet (P5 plan §7).

## 6. Reference bands — what "good" reads as

Tab. A1–A3 of the RTK (Sandau, Jentsch & Lippmann), in EMOS units. These
are **per weight class (lower / middle / upper) and sex**, which EMOS
athletes do not currently carry as structured fields (§11).

**Snatch / clean (A1, A2):**

| | Snatch | Clean |
| --- | --- | --- |
| v1 (end of first pull) | 1,20–1,30 / 1,30–1,45 / 1,40–1,50 m/s | 0,90–1,10 / 1,05–1,25 / 1,15–1,35 |
| v2 (knee passage) | = v1 ideally; up to 0,10 m/s loss tolerated | same |
| vmax | 1,50–1,70 / 1,70–1,85 / 1,80–1,95 (Ø men 1,85, women 1,90) | 1,00–1,20 / 1,20–1,40 / 1,30–1,50 (Ø 1,41 / 1,45) |
| vmin | down to −0,85 m/s | down to −1,45 |
| F1 | Ø 137 % men, 132 % women | 134 / 127 |
| F2 | Ø 100 / 109 | 89 / 99 |
| F3 | Ø 139 / 149 | 130 / 137 |
| F_br | max 145 % | ≈ 160–180 %, ideally two maxima |
| s_Rest | ≈ 60–75 % | ≈ 70–80 % |
| t_Umgr | Ø 375–385 ms men, < 390 women | 355–365 / 370–380 |

**Jerk (A3):** v_Auft ≈ 1,00–1,10 m/s; vmax 1,40–1,50 / 1,50–1,60 /
1,60–1,70 (Ø 1,68 both); vmin to −0,35; F_Auf ≈ 180 %; F_Stoß 180–190 %
(two maxima) or 220–230 % (one); F_br 125–130 %; δ_Auf 16–18 / 18–20 /
20–22 cm; δ_Ab ≈ 2–6 cm; s_Rest ≈ 60–80 %; t_Umgr ≈ 330 ms; δv_Auf ≈
10 cm. (The RTK's prose gives 1,7–1,9 m/s for the jerk's vmax after
Worobjow 1984; the table is the newer figure and wins.)

**How they are used.** Three ways, all COACH-CONFIG (a club may hold its
own bands, and the RTK's are for national-squad lifters):

1. **The `expects` block** on a model: the band a value is shown against
   in the metrics panel — "1,62 m/s · band 1,50–1,60" — never as a
   verdict word, because the everyday tier's ±0,05 m/s margin is as wide
   as the bands themselves. **Gated on the grade**, as the verdict already
   is (`lib/verdict.ts`).
2. **Refusals and sanity:** a "jerk" whose dip is 4 cm is a push press or
   a mislabel; a "snatch" with vmax 1,1 m/s from a lifter whose bands say
   1,7 is a pull or a miss. The shape check (§5.4) reads them.
3. **The variant discriminators:** catch depth (S_fall) separates power
   from full; vmin ≈ 0 separates muscle from power. `expects` carries
   these ranges per variant.

## 7. The method is the Analyzer's — a validation

The RTK §6.3.2 describes the Realanalyzer setup, and it is KinEMOS's own:
one camera at **30–40° to the platform**, **about 1 m high**, **at least
5 m away**, the **45 cm plate as the calibration body**, 2D, 50 Hz, with a
stated **3 % velocity and 10 % acceleration error**. Design §5.1's
convention (20–45°, ~1 m, distance framing, 60 fps) is the same
prescription, and the accuracy study's 2,8 % two-view agreement sits on
the Analyzer's stated figure. Worth saying on the filming checklist:
"this is how the national squad is measured".

Two differences to keep in view: the Analyzer runs at 50 Hz and the RTK
itself calls that a possible information loss (60 fps phones are ahead);
and the Analyzer needs an operator to point at the plate on the first
frame, which is the click P4c's zero-click analysis removed.

## 8. The testset: 100 clips from 2009

`Testvideos/GermanWeightliftingVideos.zip` (Danish federation footage,
100 clips) plus the two loose *Stød* clips: WMV (VC-1), 384 × 288, 50 fps,
3–10 s, each exercise from **three views** — *side* (perpendicular),
*skråt* (oblique, the Analyzer's angle) and *for* (front). Exercises,
grouped by the model they would test:

| Model | Clips (view: side / skråt / for) |
| --- | --- |
| snatch | Træk (side, skråt); Træk fra hæng / dyb hæng / blok / lav blok / høj blok (mixed); Træk overgang |
| power snatch, muscle snatch | Power pull (3 views); Power pull strict (side ×2, skrå, for); Råtræk (3) |
| snatch pull, deadlift | Trækhiv (3, plus submax ×3); Styrketræk (3) |
| clean, power clean | Stødvend (for); Stødvend hæng / dyb hæng / blok / lav blok / overgang; Frivend (for, skråt); Power pull stød (3) + strict (for, skråt) |
| clean pull | Stødhiv (3, plus submax ×3) |
| jerk, push jerk, push press, press | Opadstød (side, skråt ×2, for ×2); Knickstød (skråt, for); Push pres (3); Stem (3) |
| compound | Stød (side, skråt, for) |
| unspecified | Ben foran / bagpå (3 each); Balancetræk (3) |

**What it is good for:** the shape rules, the rep cut, the phase rules
and the compound cut — every case in §5.3–§5.5 has a clip, from two
usable angles, with a plate in view. The front views are the negative
cases: no usable plate ellipse, and the shape check should still name
the motion.

**What it is not good for:** accuracy. At 384 × 288 a 45 cm plate is
about 35 px, so a pixel is over a centimetre and the grade will be C
throughout; the P2 plan's testset v2 clips (60 fps phones) remain the
accuracy set. Pixel-level tracker work must not be tuned on these.

**Getting them in:** the frame server reads MP4/MOV/WebM through
WebCodecs and `directImport.ts` refuses WMV by design. Transcode once
into `verify/fixtures/testset-v3/` (gitignored, like v2):

```bash
ffmpeg -i "Opadstød side.wmv" -c:v libx264 -pix_fmt yuv420p -crf 18 -r 50 -an "opadstod-side.mp4"
```

A first slice needs about twelve: Opadstød side + skråt, Knickstød
skråt, Push pres side, Stød side + skråt, Stødvend blok side, Træk fra
hæng side, Træk overgang skråt, Trækhiv side, Styrketræk side, Ben foran
side. The bench harness (`verify/testset.html`) takes them as it takes
v2, and the P7 plan §6 table format is the record to keep.

## 9. What this does *not* try to do

- **Body events.** The BVDG posters delimit phases by joint angles —
  knee 117° at the bottom of the dip, hip 189° at the drive's end, the
  bar leaving the shoulders, the feet leaving the floor. KinEMOS measures
  the plate. A phase delimited by a body event is approximated by the
  nearest bar event (§3.2 says which) and labelled as such, or not
  offered. The RTK's own parameter tables are bar events throughout,
  which is why the mapping works.
- **Bar rotation, both ends, front views** — design §3 non-goals stand.
  The Darville report §2.2 documents left/right trajectory asymmetry of
  ~30 mm from a 2° bar rotation; a front-view push press shows no dip
  depth worth trusting.
- **Squats as a family.** They are the unspecified lift with a
  `dip-drive`-like shape from a high rest; if a coach wants squat
  velocity, the universal set gives it. A squat family with its own phases
  (descent, sticking point, completion) is a later decision.
- **Automatic lift naming across the library.** §4 step 4 proposes on
  the exercise; it does not relabel a thousand clips.

## 10. Delivery slices, in order

| Slice | What ships | Engine change |
| --- | --- | --- |
| **P9a — the model and the mapping** | `engine/liftModels.ts` registry; the two migrations; the resolution ladder in `lib/videoLibrary.ts` (`LibraryVideo` gains `exerciseId` and `liftModelId`); the exercise editor field; the viewer chip with override; snatch / clean / power / from-position / pull / deadlift / unspecified all segment under their model; `catch`/`recovery` split | phase sets, end rules and one `sit` rule |
| **P9b — the universal set and the bands** | the metrics in §3.3 added to the catalogue with `requires`; every surface hides what a model cannot have; `expects` bands shown beside values, grade-gated; force and power against height on the bar-path column | catalogue data; `summariseRep` grows a few fields |
| **P9c — the jerk** | shape-aware `splitReps`; the `dip-start` / `dip-bottom` / `peak-downward-velocity` rules; the jerk phase set; `JerkAnalyzerMetrics`; the compound cut for clean & jerk; rep picker names the parts; measured on the §8 clips | the real engine work |
| **P9d — the shape check** | declared-vs-observed classifier; proposals on unspecified clips; comparison guards and anchors per shape | classifier in the engine, pure |
| **P9e — live jerks** | the second live state machine | engine + one screen |

P9a and P9b are a few days and deliver the clean family and the
unspecified lift in full. P9c can now start, since jerk footage exists;
it is measured on the 2009 clips for *shape* and waits for one 60 fps
phone jerk before any accuracy claim.

## 11. What is still the coach's to decide

The sources settled the phase names, the events, the jerk's measures and
the bands. What they cannot settle:

1. **Weight class and sex on the athlete.** The bands are per class and
   sex. EMOS athletes carry neither as a structured field (there is a
   bodyweight in places, not a class). Options: add `sex` and derive the
   class from the latest bodyweight; or show the middle class's band and
   let the coach pick; or bands per athlete, hand-set. The first is
   right; it is also a data-model change outside KinEMOS.
2. **The label language.** English labels are the rule; the sources'
   symbols (v1, v2, F_br, δ_Auf) are what a German-trained coach reads.
   Proposed: English label, symbol in the column header, German term in
   the tooltip — which is what the metrics panel does for the snatch set
   today.
3. **`catch` → `catch` + `recovery`.** A change to the default set every
   stored analysis was segmented under; existing rows keep reading
   correctly (the ids they have still exist) but their metrics would be
   recomputed on next open. Fine, or keep `catch` whole and add
   `recovery` only in new models?
4. **The compound** as one library row with two reps (proposed) or two
   analyses; and whether the model chip belongs on the library row as a
   column.
5. **Whether `unspecified` shows a shape proposal** at all, or stays
   silent until asked.
6. **A 60 fps jerk clip** from a phone, side-on, plate in view through
   the rack rest — the one thing the archive cannot supply.

## 12. Built — 0.102.0 (09/09/2026)

P9a, P9b and P9c shipped together, plus the force and power curves of
§5.6; P9d (the shape check) and P9e (live jerks) are not built.

**Decisions taken while building** (Simon, 09/09/2026):

- **Turnover = Vmax → Vmin, catch = Vmin → S_sit**, then a `recovery` phase
  to the settle. The default set is six phases; a rep stored before P9
  keeps its five-phase edges and reads as a snatch from the floor
  (`liftModelOfStored`).
- **A clean & jerk is two analyses**, rep 1 the clean and rep 2 the jerk,
  swapped between in the rep pills, which name the parts.
- **The 2009 archive is the testset for now** (`verify/fixtures/testset-v3/`,
  transcoded from the WMV); accuracy waits for phone footage.

**What the 2009 clips said**, and what changed because of it:

| Clip | Model | Outcome |
| --- | --- | --- |
| Opadstød side (jerk) | jerk | dip 17,3 cm, v_Auft −0,94 m/s, δ_Stoß 22,5 cm (drive − dip +5,2), Auftakt 0,26 s, Anstoß 0,24 s — inside or beside the BVDG bands. Needed: the lift window to run 0,75 s past the burst (a bar fixed overhead is still, so the burst ends at the apex); a rep to carry a tail past its sit and to run into the following rest; a drop under believed from −0,05 m/s and a rise from 25 cm for a dip-and-drive. This lifter locks out with no drop, so the catch reads as a fallback — honestly. |
| Stød side (clean & jerk) | clean-and-jerk | cut into a clean (rise 46 cm, all six phases found) and a jerk (dip 36 cm, all six found once the dip's start was allowed at the top of the clean's recovery). The lifter never rests at the rack, which is why `splitReps` now seeds a rest at the recovery's top after a cut rep. The tracker loses the plate around the clean's catch on this footage (a 16 cm jump in two frames), which the bar path shows; the cut and the phases survive it, the numbers do not. |
| Træk side (snatch) | snatch | rise 122 cm, Vmax 2,25, turnover 0,92 → 1,34 s, catch to the sit at 1,90 s, S_sit 98,7 cm, S_fall 23,7 cm — the new turnover and catch definitions on a real snatch. No knee-passage dip on this lifter, so the transition edges fall back. |
| Trækhiv side (snatch pull) | snatch-pull | first pull, transition and second pull found, the rep ending at the apex; no catch measures offered. |
| Styrketræk side (snatch deadlift) | snatch-deadlift | one `pull` phase, lift-off to apex. |

**Known gaps after this ship:**

- The tracker on 384 × 288 footage jumps around a catch; the phase
  detector takes the global velocity maximum and can lock onto such a
  jump when it sits inside the series. The rep cut keeps it out of the
  jerk's series (the rep starts at the recovery's top); a position-jump
  repair in `engine/timing.ts` is the general fix.
- A jerk whose drop into the fix is under 0,05 m/s gets no catch edge and
  says so (fallback). Whether that lifter's fix should read as a catch of
  zero depth rather than none is a coaching question.
- The activity scan looks for a rising motion centroid; a jerk's rise is
  short and it was still found on every clip tried, but a push press with
  a small drive may not be.
- Reference bands (§6) are not shown yet: they need weight class and sex
  on the athlete (§11.1).
- `ImportControl` does not resolve a model for a direct import's exercise
  at analyse-on-import time; the library sweep and the viewer do.
