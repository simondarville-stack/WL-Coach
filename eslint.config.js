import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Hand-rolled overlays are banned outside `components/ui`.
 *
 * EMOS accumulated 44 of them: four competing primitives, 21 backdrop tints,
 * five z-index conventions, Escape in about half, one aria-modal in the whole
 * app, and no focus management anywhere. Each new one re-litigated the
 * dismissal question and usually got it wrong — most memorably, dialogs that
 * closed and discarded your typing when a text selection was dragged past the
 * panel edge. `AdaptiveDialog` owns all of that now.
 *
 * Two selectors, because overlays are written both ways in this codebase:
 * a Tailwind `fixed inset-0` class, or an inline `position:'fixed', inset:0`.
 */
const NO_HAND_ROLLED_OVERLAY = [
  {
    selector: "JSXAttribute[name.name='className'] Literal[value=/fixed inset-0/]",
    message:
      'Hand-rolled overlay. Use AdaptiveDialog from components/ui — it owns the dismissal contract (transient vs guarded), focus trap, scroll lock, aria, and the backdrop tokens.',
  },
  {
    selector:
      "JSXAttribute[name.name='style'] ObjectExpression:has(Property[key.name='position'][value.value='fixed']):has(Property[key.name='inset'][value.value=0])",
    message:
      'Hand-rolled overlay. Use AdaptiveDialog from components/ui — it owns the dismissal contract (transient vs guarded), focus trap, scroll lock, aria, and the backdrop tokens.',
  },
];

/**
 * Overlays that predate the gate. Warnings, not errors, so the build stays
 * green while the list is worked down — tranches 3 and 4. Delete entries as
 * they migrate; do not add to it.
 *
 * Anchored popovers (WeekMetricsSettings, ExerciseCategoryNav) are listed
 * because they use a full-screen click-catcher, not because they should become
 * dialogs — they are positioned against a trigger and AdaptiveDialog is the
 * wrong shape for them. They need a `Popover` primitive instead.
 */
const LEGACY_OVERLAYS = [
  'src/athlete/v2/components/AddTrainingSheet.tsx',
  'src/athlete/v2/components/AthletePrintWeek.tsx',
  'src/athlete/v2/components/BonusDayNameModal.tsx',
  'src/athlete/v2/components/ExercisePicker.tsx',
  'src/athlete/v2/components/NotDoneSheet.tsx',
  'src/athlete/v2/components/PRFormModal.tsx',
  'src/athlete/v2/screens/PRsScreen.tsx',
  'src/components/CoachProfileModal.tsx',
  'src/components/EventAttemptsModal.tsx',
  'src/components/EventOverviewModal.tsx',
  'src/components/ExerciseBulkImportModal.tsx',
  'src/components/ExerciseFormModal.tsx',
  'src/components/ShareAthleteModal.tsx',
  'src/components/ShareGroupModal.tsx',
  'src/components/TrainingGroups.tsx',
  'src/components/calendar/EventDetailModal.tsx',
  'src/components/calendar/EventFormModal.tsx',
  'src/components/exercise-library/ExerciseCategoryNav.tsx',
  'src/components/macro/MacroCreateModal.tsx',
  'src/components/macro/MacroEditModal.tsx',
  'src/components/macro/MacroExcelIO.tsx',
  'src/components/macro/MacroPhasesPanel.tsx',
  'src/components/macro/MacroTemplateSaveModal.tsx',
  'src/components/planner/ComboCreatorModal.tsx',
  'src/components/planner/PrintWeek.tsx',
  'src/components/planner/ResolvePercentagesModal.tsx',
  'src/components/planner/log/CoachSetEditModal.tsx',
  'src/components/planner/log/WeekMetricsSettings.tsx',
];

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // The gate. `components/ui` is exempt — that is where overlays live.
    files: ['src/**/*.tsx'],
    ignores: ['src/components/ui/**'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_HAND_ROLLED_OVERLAY],
    },
  },
  {
    files: LEGACY_OVERLAYS,
    rules: {
      'no-restricted-syntax': ['warn', ...NO_HAND_ROLLED_OVERLAY],
    },
  }
);
