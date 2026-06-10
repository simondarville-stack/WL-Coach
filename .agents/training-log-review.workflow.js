export const meta = {
  name: 'training-log-review',
  description: 'Deep multi-agent review of the EMOS training-log subsystem: coach planning inputs, athlete entry, coach review, metrics translation, and UI best practice',
  phases: [
    { title: 'Map', detail: 'Parallel discovery of the prescription-type system + full data flow' },
    { title: 'Review', detail: 'Per-dimension findings with file:line evidence' },
    { title: 'Verify', detail: 'Adversarial verification of each finding against the real code' },
    { title: 'Synthesize', detail: 'Dedup, prioritise, write the report' },
  ],
}

// ─── Shared project context handed to every agent ──────────────────────────
const CTX = `
EMOS is an Olympic-weightlifting (OWL) coaching web app. React 18 + TS strict + Vite + Tailwind + Supabase + Recharts.
Two surfaces share one training-log data model:
  • COACH app (light theme, uses design tokens in src/styles/tokens.css; Button primitive in src/components/ui).
  • ATHLETE app (src/athlete/v2/*) — a DELIBERATELY SEPARATE dark mobile theme (gray-900 etc). Raw dark Tailwind in the athlete app is INTENTIONAL, not an off-brand bug. Do NOT flag athlete-app dark colours as token violations.

Non-negotiable EMOS principles (use as review lenses):
  1. Coach-flexibility over hardcoding — any OWL concept a coach might define differently must be runtime-configurable.
  2. API-first: presentational components must not call supabase directly; all log data access goes through src/lib/trainingLogService.ts.
  3. Single source of truth per concept (prescription parsing = src/lib/prescriptionParser.ts; display = StackedNotation.tsx).
  4. Planned data is coach-authored and READ-ONLY in athlete views. Athlete input is stored SEPARATELY as logs (training_log_*) and must NEVER overwrite planned data. Compliance/deltas are derived by comparison, not mutation.
  5. European conventions: DD/MM dates, 24h time, Monday-first weeks, comma decimals. Labels English.

The prescription-type system a coach can author (this is the crux of the review):
  • unit on planned_exercises ∈ { absolute_kg, percentage, rpe, free_text, free_text_reps, other }
  • is_combo exercises (combo_notation + "+"-tuple reps like "80×2+1×3")
  • sentinel exercises keyed by exercise_code ∈ { TEXT, IMAGE, VIDEO, GPP } (see src/components/planner/sentinelUtils.ts)
  • structured planned_set_lines vs free prescription_raw text
  • detectIntendedUnit() maps ANY letter in input → free_text_reps; "%" → percentage; pure number → absolute_kg.

THE USER'S VERBATIM CONCERN (keep front of mind):
"Review the entire way the training logs are made — it feels a little buggy. Review all the types and ways the coach can plan inputs. An example problem: an exercise described using free text ALSO creates a SET with the athlete. It should just be accepted, or marked 'did not do it' — it should NOT generate a set. Make sure all the ways the athlete interacts with the programme is robust. Ensure every TYPE of object an athlete can write in the prescription, or metrics gathered via the 'Metrics' function, translates well to the athlete. Prove all decisions are within good UI best practice. Cover BOTH the coach-facing training log (for review) AND the athlete-facing training log entry."

Rules for your output: READ the actual files you are given (do not guess). Every finding MUST cite file:line. Distinguish a real reachable bug from a theoretical one. Prefer concrete reproduction conditions ("unit=free_text_reps + prescription_raw has no 'x' ⇒ zero rows ⇒ dead card").
`

// ─── File groups ────────────────────────────────────────────────────────────
const COACH_AUTHOR_FILES = [
  'src/components/planner/PrescriptionGrid.tsx',
  'src/components/planner/DayCard.tsx',
  'src/components/planner/DayEditor.tsx',
  'src/components/planner/ExerciseDetail.tsx',
  'src/components/planner/ComboCreatorModal.tsx',
  'src/components/planner/GppBlockEditor.tsx',
  'src/components/planner/SentinelDisplay.tsx',
  'src/components/planner/StackedNotation.tsx',
  'src/components/planner/ExerciseSearch.tsx',
  'src/components/planner/PlannerControlPanel.tsx',
  'src/components/planner/sentinelUtils.ts',
  'src/lib/prescriptionParser.ts',
]
const ATHLETE_FILES = [
  'src/athlete/v2/AthleteApp.tsx',
  'src/athlete/v2/screens/WeekScreen.tsx',
  'src/athlete/v2/screens/TodayScreen.tsx',
  'src/athlete/v2/screens/GroupViewerScreen.tsx',
  'src/athlete/v2/components/ExerciseLogCard.tsx',
  'src/athlete/v2/components/SetEntryRow.tsx',
  'src/athlete/v2/components/OffPlanExerciseCard.tsx',
  'src/athlete/v2/components/GppLogCard.tsx',
  'src/athlete/v2/components/ExercisePicker.tsx',
  'src/athlete/v2/components/SessionHeader.tsx',
  'src/athlete/v2/components/SessionPreview.tsx',
  'src/athlete/v2/components/DayChipRow.tsx',
  'src/athlete/v2/components/WeekNavigator.tsx',
  'src/athlete/v2/components/BonusDayNameModal.tsx',
  'src/lib/trainingLogService.ts',
  'src/lib/trainingLogModel.ts',
  'src/lib/prescriptionParser.ts',
]
const COACH_REVIEW_FILES = [
  'src/components/planner/log/LogModeView.tsx',
  'src/components/planner/log/LogExerciseRow.tsx',
  'src/components/planner/log/PlanActual.tsx',
  'src/components/planner/log/CoachSetEditModal.tsx',
  'src/components/planner/log/LogDayCard.tsx',
  'src/components/planner/log/LogWeekOverview.tsx',
  'src/components/planner/log/GroupLogView.tsx',
  'src/components/planner/log/LogCommentsThread.tsx',
  'src/components/planner/log/logSummary.ts',
  'src/lib/trainingLogModel.ts',
  'src/lib/trainingLogService.ts',
]
const METRICS_FILES = [
  'src/components/planner/log/WeekMetricsSettings.tsx',
  'src/components/analysis/builder/MetricsModal.tsx',
  'src/components/analysis/builder/coachMetrics.ts',
  'src/lib/analysis/metricRegistry.ts',
  'src/lib/metrics.ts',
  'src/athlete/v2/components/RawScoreDial.tsx',
  'src/athlete/v2/components/VasField.tsx',
  'src/athlete/v2/components/BodyweightField.tsx',
  'src/athlete/v2/components/CustomMetricField.tsx',
  'src/athlete/v2/components/SessionHeader.tsx',
  'src/lib/trainingLogModel.ts',
]

// ─── Schemas ─────────────────────────────────────────────────────────────────
const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'summary', 'items', 'dataFlowNotes', 'openQuestions'],
  properties: {
    area: { type: 'string' },
    summary: { type: 'string', description: 'Plain-language overview of how this area works' },
    items: {
      type: 'array',
      description: 'One row per distinct object/type a coach can author or metric collected',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'whereAuthored', 'howStored', 'howRenderedToAthlete', 'howReviewedByCoach', 'fileRefs', 'notes'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', description: 'unit | sentinel | combo | set-line | metric | other' },
          whereAuthored: { type: 'string', description: 'Coach UI + file:line where this is created/edited' },
          howStored: { type: 'string', description: 'DB columns/tables and shape' },
          howRenderedToAthlete: { type: 'string', description: 'Exact athlete render path + file:line; note if it yields a set row, a note, ✓/✗, etc.' },
          howReviewedByCoach: { type: 'string', description: 'Coach Log-mode review render path + file:line' },
          fileRefs: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', description: 'Edge cases, dead-ends, smells observed' },
        },
      },
    },
    dataFlowNotes: { type: 'string' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}

const FINDING = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'severity', 'category', 'surface', 'files', 'evidence', 'userImpact', 'recommendation', 'confidence'],
  properties: {
    id: { type: 'string', description: 'Dimension-prefixed, e.g. TYPE-1, ROBUST-3' },
    title: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'nit'] },
    category: { type: 'string', enum: ['bug', 'data-loss', 'robustness', 'translation', 'ux', 'a11y', 'consistency', 'architecture'] },
    surface: { type: 'string', enum: ['coach-planning', 'coach-review', 'athlete-entry', 'metrics', 'shared'] },
    files: { type: 'array', items: { type: 'string' }, description: 'file:line references' },
    evidence: { type: 'string', description: 'Concrete code evidence + reproduction condition + why it is a problem' },
    userImpact: { type: 'string', description: 'What the coach/athlete actually experiences' },
    recommendation: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
}
const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'overview', 'findings'],
  properties: {
    dimension: { type: 'string' },
    overview: { type: 'string', description: 'Short verdict on this dimension overall' },
    findings: { type: 'array', items: FINDING },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findingId', 'verdict', 'severityAdjusted', 'reasoning'],
  properties: {
    findingId: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'partial', 'refuted'] },
    severityAdjusted: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'nit'] },
    reasoning: { type: 'string', description: 'What you re-read and whether the code path is actually reachable / the impact is right' },
    correctedEvidence: { type: 'string', description: 'Optional: corrected file:line or condition if the original was wrong' },
  },
}

// ─── Map phase ───────────────────────────────────────────────────────────────
function mapPrompt(area, files, focus) {
  return `${CTX}

YOU ARE A DISCOVERY MAPPER for the "${area}" area of the EMOS training log.
Read EVERY file below, fully, and build a precise factual map. Do NOT judge quality here — just document exactly how it works, with file:line refs. Trace each distinct authorable object/type from coach → storage → athlete render → coach review.

FOCUS: ${focus}

FILES TO READ (all of them):
${files.map(f => '  - ' + f).join('\n')}

Use Grep/Read freely to follow call sites beyond this list when needed (e.g. how unit is set in the grid, how save writes training_log_sets). For each distinct type/object, fill one item row. Be exhaustive about the unit/sentinel/combo matrix and where a path yields a SET row vs a note vs a ✓/✗ accept.`
}

// ─── Review phase ────────────────────────────────────────────────────────────
const DIMENSIONS = [
  {
    key: 'type-translation',
    title: 'Prescription-type translation correctness',
    files: COACH_AUTHOR_FILES.concat(ATHLETE_FILES),
    focus: `Does EVERY object a coach can author translate correctly to the athlete? Build the matrix: absolute_kg, percentage, rpe, free_text, free_text_reps, other, combo, and sentinels TEXT/IMAGE/VIDEO/GPP — for each, what does the athlete see and is it sensible?
HEADLINE: the user reports a free-text exercise wrongly GENERATES A SET for the athlete instead of a simple accept / "didn't do it". Pin down the EXACT condition (which unit/sentinel, empty setLines, detectIntendedUnit behaviour) and root cause with file:line. Also hunt: free_text_reps with prose that has no parseable "x reps" ⇒ zero rows ⇒ dead card with no way to mark done; percentage/rpe rows where "Log as prescribed" is hidden (canLogAsPrescribed gates on absolute_kg only) — is that the right call?; combo tuple round-tripping; substitution display; group-viewer read-only paths. Judge whether each translation is the RIGHT product decision, not just whether it runs.`,
  },
  {
    key: 'athlete-robustness',
    title: 'Athlete-entry robustness (bugs, races, data-loss, dead-ends)',
    files: ATHLETE_FILES,
    focus: `Stress every way the athlete interacts with the programme. Hunt: set_number upsert-collision / overwrite (data loss), the per-row write-queue (chainRef) correctness, optimistic-state vs server-refetch stomping mid-edit, "Add set" numbering after deletes/gaps, removePlannedSet metadata path, off-plan adds, bonus days, substitution, GPP block persistence, the historic duplicate-row race noted in ensureLogExercise, empty/dead-end states (no plan, group plan only, zero rows), error handling on save failure (does the athlete lose data or get feedback?), and offline/double-tap. Each finding: reproduction condition + file:line + does the athlete LOSE data or get stuck.`,
  },
  {
    key: 'coach-review',
    title: 'Coach-facing log review correctness',
    files: COACH_REVIEW_FILES,
    focus: `The coach reviews what the athlete did (Log mode on the Weekly Planner). Verify: Plan-vs-Actual rendering for EVERY prescription type (esp. free_text/sentinel/combo — do they render sanely on the coach side or show "set 1/1" noise that mirrors the athlete bug?), delta computation (computeDelta/computeDelta thresholds, skipped vs pending, planned=0 edge), CoachSetEditModal writes (does the coach editing performed values violate planned-vs-logged separation or overwrite plan?), group log aggregation, comments thread, week overview status roll-up, and whether free-text/accept-only exercises produce misleading compliance numbers. file:line evidence.`,
  },
  {
    key: 'metrics-translation',
    title: 'Metrics function translation (config → athlete input → review)',
    files: METRICS_FILES,
    focus: `The coach's "Metrics" function (WeekMetricsSettings + custom metric definitions) decides which inputs the athlete is asked for: RAW (Eleiko 4-pillar), bodyweight, VAS, and custom metrics (number/text). For EACH metric type verify the full round-trip: coach enables it → athlete sees the right input control (RawScoreDial, VasField, BodyweightField, CustomMetricField) → value saves to the right column/json (raw_*, bodyweight_kg, vas_score, custom_metrics) → coach can review it. Hunt: custom text vs number rendering, unit display, archived definitions still enabled, per-week config fallback default, VAS/RAW scale correctness, and whether any enabled metric has no athlete control (or vice-versa). Note any hardcoded OWL assumptions that violate coach-flexibility. file:line evidence.`,
  },
  {
    key: 'ux-bestpractice',
    title: 'UI/UX best practice (coach + athlete)',
    files: ATHLETE_FILES.concat(COACH_REVIEW_FILES, ['src/styles/tokens.css', 'src/components/planner/log/WeekMetricsSettings.tsx']),
    focus: `Judge against good UI best practice AND the EMOS design system. Read src/styles/tokens.css and the design-system section of CLAUDE.md first. COACH (light) surfaces must use Button primitive + design tokens (flag bg-blue-600/raw gray-* in coach code, malformed border-[var()] without color: hint, US date formats, hand-rolled hover icon buttons). ATHLETE app is intentionally dark — judge it on mobile-UX merit (tap-target size ≥40px, contrast, affordance clarity, loading/empty/error states, destructive-action confirmation, the ✓/✗/trash semantics, information density per CLAUDE.md "expert tool" ethos), NOT on token compliance. Also assess: is the set-vs-accept distinction visually clear? does the prescription notation read well? are chips signal-bearing or noise (CLAUDE.md: drop chips that appear on every row)? Provide concrete, evidence-backed findings — the user wants UX decisions PROVEN, so cite the rule each finding violates or upholds.`,
  },
]

function reviewPrompt(dim, mapJson) {
  return `${CTX}

YOU ARE THE "${dim.title}" REVIEWER.
A shared factual MAP of the subsystem (built by discovery agents) is provided below as JSON — use it for cross-reference and to avoid re-deriving the data flow, but VERIFY anything you cite by reading the real code.

=== SHARED MAP (JSON) ===
${mapJson}
=== END MAP ===

YOUR FOCUS:
${dim.focus}

PRIMARY FILES (read deeply; follow call sites as needed):
${dim.files.map(f => '  - ' + f).join('\n')}

Produce findings. Each finding: stable id prefixed "${dim.key.toUpperCase()}-", precise file:line, a concrete reproduction condition, the real user impact, and a specific recommendation that respects EMOS principles. Severity honestly (critical = data loss / athlete can't log / coach sees wrong truth; nit = polish). Quality matters more than quantity — but be exhaustive within your dimension. If something is actually GOOD, you may note it in the overview, but findings are for problems/improvements.`
}

// ─── Verify phase ────────────────────────────────────────────────────────────
function verifyPrompt(f, lens) {
  const lensText = lens === 'reachability'
    ? 'LENS = REACHABILITY: Re-read the cited code and the surrounding call sites. Is this code path actually reachable at runtime? Does the bug actually manifest given how the data is really produced/stored/rendered? Default to "refuted" if you cannot substantiate the exact condition from the real code.'
    : 'LENS = IMPACT & FIX SOUNDNESS: Is the severity/userImpact accurate (not inflated)? Is the recommendation correct and consistent with EMOS principles (coach-flexibility, planned-vs-logged separation, single-source-of-truth, athlete-app-is-dark, design tokens for coach)? Could the proposed fix break another prescription type or surface? Default to "partial" if the bug is real but severity/fix is off; "refuted" if not a real problem.'
  return `${CTX}

You are an ADVERSARIAL VERIFIER. A reviewer raised this finding. Your job is to try to REFUTE it by reading the actual code, then return an honest verdict.

${lensText}

FINDING UNDER TEST:
${JSON.stringify(f, null, 2)}

Read the cited files (and anything adjacent needed to judge). Return verdict (confirmed/partial/refuted), an honest adjusted severity, and reasoning grounded in specific file:line. If the original evidence cited the wrong line or condition but the problem is real, mark "partial" and give correctedEvidence.`
}

async function verifyOne(f) {
  const lenses = (f.severity === 'critical' || f.severity === 'high')
    ? ['reachability', 'impact-fix']
    : ['reachability']
  const verdicts = (await parallel(lenses.map(lens => () =>
    agent(verifyPrompt(f, lens), { label: `verify:${f.id}:${lens}`, phase: 'Verify', schema: VERDICT_SCHEMA }),
  ))).filter(Boolean)
  if (verdicts.length === 0) return { ...f, confirmed: true, verdicts: [], verifyNote: 'verifier-unavailable-kept' }
  const refuted = verdicts.filter(v => v.verdict === 'refuted').length
  const confirmed = refuted < verdicts.length // survive unless ALL verifiers refute
  // Adopt the adjusted severity from a non-refuting verifier (lowest agreed if multiple)
  const order = { critical: 4, high: 3, medium: 2, low: 1, nit: 0 }
  const adjustedSevs = verdicts.filter(v => v.verdict !== 'refuted').map(v => v.severityAdjusted)
  const severity = adjustedSevs.length
    ? adjustedSevs.reduce((lo, s) => (order[s] < order[lo] ? s : lo), adjustedSevs[0])
    : f.severity
  const anyPartial = verdicts.some(v => v.verdict === 'partial')
  return { ...f, severity, confirmed, verdict: confirmed ? (anyPartial ? 'partial' : 'confirmed') : 'refuted', verdicts }
}

async function verifyFindings(reviewResult, dim) {
  const findings = (reviewResult && reviewResult.findings) ? reviewResult.findings : []
  if (findings.length === 0) {
    log(`${dim.key}: 0 findings`)
    return []
  }
  log(`${dim.key}: verifying ${findings.length} findings`)
  const verified = await parallel(findings.map(f => () => verifyOne(f)))
  return verified.filter(Boolean).map(v => ({ ...v, dimension: dim.key, dimensionOverview: reviewResult.overview }))
}

// ─── Run ─────────────────────────────────────────────────────────────────────
phase('Map')
const maps = (await parallel([
  () => agent(mapPrompt('coach-authoring & type system', COACH_AUTHOR_FILES,
    'How the coach authors every prescription type (grid cell, free-form, unit auto-detect, combo creator, GPP block editor, sentinel insertion). Document the unit/sentinel/combo matrix and exactly what gets stored.'),
    { label: 'map:type-system', phase: 'Map', schema: MAP_SCHEMA }),
  () => agent(mapPrompt('athlete render & entry', ATHLETE_FILES,
    'How each planned type renders for the athlete and how entry is saved. For each type note whether the athlete gets numeric set rows, a single ✓/✗ accept row, a note with no entry, or a dead end. Document the save path to training_log_* and the set_number key.'),
    { label: 'map:athlete-flow', phase: 'Map', schema: MAP_SCHEMA }),
  () => agent(mapPrompt('coach log-mode review', COACH_REVIEW_FILES,
    'How the coach reviews logged sessions: plan-vs-actual, deltas, set edit modal, group log, comments, week-overview status. Note how non-numeric types (free_text/sentinel/combo) render on the review side.'),
    { label: 'map:coach-review', phase: 'Map', schema: MAP_SCHEMA }),
  () => agent(mapPrompt('metrics function', METRICS_FILES,
    'The coach Metrics function: which metrics exist (RAW, BW, VAS, custom number/text), how per-week config selects them, which athlete control renders each, and where each value is stored + reviewed.'),
    { label: 'map:metrics', phase: 'Map', schema: MAP_SCHEMA }),
])).filter(Boolean)
const mapJson = JSON.stringify(maps, null, 2)
log(`Map complete: ${maps.length} area maps`)

phase('Review')
const dimResults = await pipeline(
  DIMENSIONS,
  (dim) => agent(reviewPrompt(dim, mapJson), { label: `review:${dim.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (review, dim) => verifyFindings(review, dim),
)

const allVerified = dimResults.flat().filter(Boolean)
const confirmed = allVerified.filter(f => f.confirmed)
const refuted = allVerified.filter(f => !f.confirmed)
log(`Findings: ${confirmed.length} confirmed, ${refuted.length} refuted`)

phase('Synthesize')
const synthPrompt = `${CTX}

You are the SYNTHESIZER. Below are (a) the factual subsystem map and (b) all VERIFIED findings (adversarially checked; refuted ones excluded). Write the definitive review report as GitHub-flavoured Markdown.

Required structure:
1. ## Verdict — is the training-log subsystem "buggy"? Give an honest overall assessment and the 3-5 dominant themes. Lead with the headline answer to the user's free-text-creates-a-set complaint (root cause + the one-line fix direction).
2. ## Prescription-type translation matrix — a Markdown table: Type | What coach authors | What athlete sees | Coach-review render | Verdict (✅ good / ⚠️ needs work / ❌ broken). Cover absolute_kg, percentage, rpe, free_text, free_text_reps, other, combo, TEXT, IMAGE, VIDEO, GPP.
3. ## Critical & High findings — grouped, each: **[ID] Title** (severity, surface), file:line, impact, recommendation. Order by severity then surface.
4. ## Medium / Low / Nits — compact list.
5. ## UI/UX best-practice assessment — coach surface vs athlete surface, citing the specific rule each call upholds/violates (the user wants decisions PROVEN).
6. ## Robustness assessment — data-loss / race / dead-end risks in athlete entry, with a one-line risk rating each.
7. ## Recommended fix order — a prioritised, sequenced plan (P0/P1/P2) the user can act on, noting which fixes share a root cause.

Be specific and cite file:line throughout. De-duplicate findings that multiple dimensions raised (merge them, keep all file refs). Surface any cross-perspective tension as an explicit trade-off. Do not invent findings beyond the provided set, but you MAY add brief connective analysis.

=== MAP (JSON) ===
${mapJson}

=== VERIFIED FINDINGS (JSON) ===
${JSON.stringify(confirmed, null, 2)}

=== REFUTED (for your awareness; do not include unless to note a non-issue the user might assume) ===
${JSON.stringify(refuted.map(r => ({ id: r.id, title: r.title, reason: (r.verdicts && r.verdicts[0] && r.verdicts[0].reasoning) || '' })), null, 2)}
`
const report = await agent(synthPrompt, { label: 'synthesize', phase: 'Synthesize' })

return {
  report,
  confirmedCount: confirmed.length,
  refutedCount: refuted.length,
  bySeverity: {
    critical: confirmed.filter(f => f.severity === 'critical').length,
    high: confirmed.filter(f => f.severity === 'high').length,
    medium: confirmed.filter(f => f.severity === 'medium').length,
    low: confirmed.filter(f => f.severity === 'low').length,
    nit: confirmed.filter(f => f.severity === 'nit').length,
  },
  findings: confirmed,
  maps,
}
