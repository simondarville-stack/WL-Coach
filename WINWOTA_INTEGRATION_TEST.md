# WINWOTA 2.0 — FULL INTEGRATION TEST: SMOLOV PROGRAM

You are going to act as BOTH coach and athlete. Create test data,
plan a real program, log workouts, and verify the entire system works
end-to-end. Fix any bugs you discover along the way.

Connect to Chrome. Open http://localhost:5173.
Do not ask for confirmation. Fix issues as you find them.

---

## STEP 1: CREATE TEST ATHLETE

Navigate to Roster page. Create a new athlete:
- Name: Claude
- Birthdate: 1998-03-15
- Bodyweight: 89
- Weight class: 89kg
- Club: Anthropic WL Club
- Notes: Test athlete for integration testing
- Track bodyweight: enabled
- Photo: Search the web for a royalty-free weightlifting photo 
  (use unsplash.com or similar). Download it and upload it as 
  Claude's profile photo. If photo upload doesn't work through
  the UI, use Supabase storage directly via the JS client:
  ```
  const file = await fetch(imageUrl).then(r => r.blob());
  const { data } = await supabase.storage.from('avatars').upload('claude-test.jpg', file);
  // Then update athlete.photo_url with the public URL
  ```
  If this is too complex, skip the photo and move on.

Verify Claude appears in the Roster and can be selected in the
athlete selector dropdown.

---

## STEP 2: ADD PR FOR BACK SQUAT

Before planning, Claude needs a Back Squat 1RM so percentages work.

Navigate to Claude's PR page (if it exists) or use Supabase directly:
- Find or create exercise "Claude Back Squat" in the Exercise Library:
  - Name: Claude Back Squat
  - Category: Squat
  - Default unit: absolute_kg
  - Color: pick any blue shade
  - Exercise code: CBS
- Set Claude's 1RM for Claude Back Squat: 170 kg

You can do this through the UI or via Supabase:
```javascript
// Find or create exercise
let { data: ex } = await supabase
  .from('exercises').select('id').eq('name', 'Claude Back Squat').maybeSingle();
if (!ex) {
  const { data } = await supabase.from('exercises').insert({
    name: 'Claude Back Squat',
    category: 'Squat',
    default_unit: 'absolute_kg',
    color: '#378ADD',
    exercise_code: 'CBS',
    counts_towards_totals: true,
  }).select().single();
  ex = data;
}

// Set PR
await supabase.from('athlete_prs').upsert({
  athlete_id: claudeAthleteId,
  exercise_id: ex.id,
  load: 170,
  reps: 1,
  date: new Date().toISOString().split('T')[0],
});
```

---

## STEP 3: RESEARCH SMOLOV PROGRAM

Search the web for "Smolov squat program base mesocycle" to get the
exact prescription. The Smolov Base Mesocycle is:

Week 1:
- Day 1 (Mon): 4 sets × 9 reps @ 70% (119 kg for 170 1RM)
- Day 2 (Wed): 5 sets × 7 reps @ 75% (128 kg)
- Day 3 (Fri): 7 sets × 5 reps @ 80% (136 kg)
- Day 4 (Sat): 10 sets × 3 reps @ 85% (145 kg)

Week 2: same structure, add 5-10 kg to each day
- Day 1: 4×9 @ 124 kg
- Day 2: 5×7 @ 133 kg
- Day 3: 7×5 @ 141 kg
- Day 4: 10×3 @ 150 kg

Week 3: add another 5-10 kg
- Day 1: 4×9 @ 129 kg
- Day 2: 5×7 @ 138 kg
- Day 3: 7×5 @ 146 kg
- Day 4: 10×3 @ 155 kg

Week 4 (Deload):
- Day 1: 3×5 @ 60% (102 kg)
- Day 2: 3×5 @ 65% (111 kg)
- Day 3: 3×3 @ 70% (119 kg)

Verify these numbers by searching. Adjust if your research shows
different values. Use rounded kg values.

---

## STEP 4: CREATE MACROCYCLE

Navigate to Macro Cycles page. Select Claude as the athlete.

Create a new macrocycle:
- Name: Smolov Base Mesocycle
- Start date: today's Monday (start of this week)
- End date: 4 weeks from start
- Create 4 weeks

Set up phases:
- Phase 1: "Loading" (weeks 1-3), color: blue
- Phase 2: "Deload" (week 4), color: green

Set week types:
- Week 1: High volume
- Week 2: High volume
- Week 3: High volume (peak)
- Week 4: Deload

Set total reps targets per week:
- Week 1: 4×9 + 5×7 + 7×5 + 10×3 = 36+35+35+30 = 136 reps
- Week 2: same = 136 reps
- Week 3: same = 136 reps
- Week 4: 3×5 + 3×5 + 3×3 = 15+15+9 = 39 reps

If the UI doesn't support all of these operations, do as much as
possible through the UI, then fill in missing data via Supabase.

---

## STEP 5: PLAN WEEKLY TRAINING

Navigate to Weekly Planner. Select Claude.

### Week 1 (navigate to the correct week)

Set up 4 training days via Day Config:
- Day 1: "Heavy 9s"
- Day 2: "Volume 7s"  
- Day 3: "Strength 5s"
- Day 4: "Intensity 3s"

For each day, add exercise "Claude Back Squat" and set the
prescription using the grid or text input:

**Day 1 (Heavy 9s):**
Add Claude Back Squat. Set prescription: `119x9x4`
(119 kg, 9 reps, 4 sets)

**Day 2 (Volume 7s):**
Add Claude Back Squat. Set prescription: `128x7x5`

**Day 3 (Strength 5s):**
Add Claude Back Squat. Set prescription: `136x5x7`

**Day 4 (Intensity 3s):**
Add Claude Back Squat. Set prescription: `145x3x10`

Also add a free text note on Day 1: "/text" → 
"Smolov Base Mesocycle - Week 1. Focus on depth and consistency."

Verify the day cards show the prescriptions correctly with stacked
notation. Verify the weekly summary shows correct totals:
- Total sets: 4+5+7+10 = 26
- Total reps: 36+35+35+30 = 136
- Check tonnage calculation

### Week 2
Navigate to next week. Set up same 4 days.
Prescriptions with +5 kg:
- Day 1: 124x9x4
- Day 2: 133x7x5
- Day 3: 141x5x7
- Day 4: 150x3x10

### Week 3
Navigate to next week. Same structure, +5 kg:
- Day 1: 129x9x4
- Day 2: 138x7x5
- Day 3: 146x5x7
- Day 4: 155x3x10

### Week 4 (Deload)
Navigate to next week. Set up 3 training days:
- Day 1: "Recovery A" — 102x5x3
- Day 2: "Recovery B" — 111x5x3
- Day 3: "Test prep" — 119x3x3

---

## STEP 6: VERIFY PLANNER

Go back to Week 1 and verify:
1. All 4 days show correct exercises and prescriptions
2. Weekly summary shows 136 total reps
3. Macro context shows "Smolov Base Mesocycle", Week 1, Loading phase
4. The macro timeline bar is visible with phase colors
5. Copy week functionality works (copy Week 1, don't paste)
6. Print view works — check both Programme and Compact modes
7. Load distribution chart shows if toggled on

Navigate through all 4 weeks and verify each one has correct data.

---

## STEP 7: LOG WORKOUTS AS ATHLETE

Navigate to Training Log. Select Claude.

### Log Week 1, Day 1 (Heavy 9s)
1. Open the session for Day 1
2. Fill RAW readiness: Sleep 3, Physical 3, Mood 3, Nutrition 3 (total 12)
3. Start the session
4. Complete all sets as prescribed (119 kg × 9 reps × 4 sets)
   - If the UI has set-by-set logging, complete each set
   - If it uses performed_raw text, enter "119x9x4"
5. Add session note: "Felt strong. Good depth on all reps."
6. Rate session RPE: 7
7. Complete the session

### Log Week 1, Day 2 (Volume 7s)
1. Open Day 2 session
2. RAW: Sleep 2, Physical 2, Mood 3, Nutrition 3 (total 10)
3. Complete as prescribed: 128x7x5
4. Session note: "Legs tired from day 1 but managed all sets."
5. RPE: 8
6. Complete session

### Log Week 1, Day 3 (Strength 5s)
1. Open Day 3
2. RAW: Sleep 3, Physical 2, Mood 3, Nutrition 2 (total 10)
3. Log MODIFIED performance — simulate the athlete adjusting:
   - Sets 1-5: performed as planned (136x5)
   - Set 6: only managed 4 reps (136x4)
   - Set 7: only managed 3 reps (136x3)
   - So performed_raw might be: "136x5x5, 136x4, 136x3"
   - Or if set-by-set: mark sets 1-5 complete, set 6 with 4 reps, set 7 with 3 reps
4. Session note: "Fatigue catching up. Missed reps on last 2 sets."
5. RPE: 9
6. Complete session

### Log Week 1, Day 4 (Intensity 3s)
1. Open Day 4
2. RAW: Sleep 3, Physical 2, Mood 2, Nutrition 3 (total 10)
3. Complete as prescribed: 145x3x10
4. Session note: "Heavy but completed all sets. Grinding on last 3 sets."
5. RPE: 9
6. Complete session

### Log Week 2 — abbreviated
Log all 4 days of Week 2 with:
- All sessions completed as prescribed
- RAW scores: vary between 9-12
- RPE: vary between 7-9
- Add brief session notes

### Log Week 3 — simulate struggle
- Day 1: completed as prescribed
- Day 2: missed 2 reps on last set (138x7x4, 138x5)
- Day 3: completed but RPE 10
- Day 4: athlete failed on set 8, stopped at 7 sets (155x3x7)
  Add note: "Could not complete program. Need to reassess 1RM."

### Week 4 (Deload) — log all completed
- All 3 days completed as prescribed
- RAW scores: 11-12 (recovered)
- RPE: 5-6

---

## STEP 8: ADD BODYWEIGHT ENTRIES

Log bodyweight entries for Claude across the 4 weeks:
- Week 1: 89.2, 89.5, 89.3, 89.4
- Week 2: 89.6, 89.8, 89.5, 89.7
- Week 3: 90.0, 90.2, 89.8, 90.1
- Week 4: 89.5, 89.3, 89.2

Use Supabase or the bodyweight popup if it exists:
```javascript
const entries = [
  // Week 1 - use actual dates
  { athlete_id: claudeId, weight_kg: 89.2, measured_at: '2026-04-06' },
  { athlete_id: claudeId, weight_kg: 89.5, measured_at: '2026-04-07' },
  // ... etc
];
await supabase.from('bodyweight_entries').insert(entries);
```

---

## STEP 9: VERIFY ANALYSIS

Navigate to Analysis page. Select Claude.

### Pivot Builder
1. Set period to "4 weeks" or "Current macro"
2. X axis: Week
3. Primary metric: Exercise avg load
4. Filter to Claude Back Squat
5. Verify the chart shows increasing load across weeks 1-3, drop in week 4
6. Add bodyweight overlay — verify it shows slight upward trend

### Planned vs Performed
1. Click the preset or build it manually
2. Verify:
   - Week 1: compliance < 100% (Day 3 had missed reps)
   - Week 2: compliance = 100%
   - Week 3: compliance < 100% (Day 2 and Day 4 had missed reps/sets)
   - Week 4: compliance = 100%
   - Color coding: green for 100%, amber/red for incomplete weeks
3. Verify tonnage numbers make sense:
   - Week 1 planned: 119×36 + 128×35 + 136×35 + 145×30 = ~17,000 kg
   - Week 1 performed: slightly less (Day 3 missed reps)

### Intensity Zones
1. Select Claude Back Squat
2. Verify zones make sense for Smolov:
   - Weeks 1-3: most volume in 70-85% zone
   - Week 4: all in 60-70% zone
3. The zone breakdowns should show the periodization pattern

### Lift Ratios
1. This won't be very useful with only one exercise
2. Verify it doesn't crash or show errors
3. Should show "Insufficient data" or similar for ratios
   that need multiple exercises

### Quick Analyses
Click through each preset and verify nothing crashes.
Data may be sparse (only one exercise) but should not error.

---

## STEP 10: VERIFY DASHBOARD

Navigate to Dashboard.
1. Claude should appear in the athlete list
2. Status should show sessions completed
3. If compliance sparklines exist, they should show data
4. If "upcoming events" section exists, it should work (may be empty)

---

## STEP 11: VERIFY CALENDAR

Navigate to Calendar.
1. Verify it loads without errors
2. If any events exist, they should display

---

## STEP 12: VERIFY PRINT

Go back to Weekly Planner, Week 1, Claude selected.
1. Click Print
2. Test "Programme" mode — verify all exercises show with prescriptions
3. Test "Compact" mode — verify the IAT-style layout renders:
   - Exercise code "CBS" (or "Claude Back Squat" abbreviated)
   - Load/reps in stacked notation
   - WH / MHG / BW columns
   - Free text note shows
4. Click browser print (Ctrl+P) — verify layout fits A4

---

## STEP 13: CLEANUP

After all tests pass, you can either:
- Leave Claude as a test athlete (useful for future testing)
- Or add a note in the athlete's notes: "TEST ATHLETE — safe to delete"

---

## BUGS TO FIX

Throughout this entire process, you WILL encounter bugs. Common ones:
- Form validation errors when creating athletes/exercises
- Prescription parsing edge cases
- Grid values not persisting (the fire-and-forget save issue)
- Macro context not loading for certain weeks
- Analysis charts showing NaN or Infinity
- Missing null checks causing crashes
- Training log session creation failures (constraint violations)
- Print layout rendering issues

**Fix every bug you encounter immediately.** Don't note it for later — 
fix it, verify the fix, then continue the test.

Commit all fixes with descriptive messages. When done, push the branch.
