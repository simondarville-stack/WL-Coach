# EMOS — PROMPT 1: DESIGN TOKENS + TAILWIND CONFIG

This is step 1 of 3 in rolling out the EMOS design system. It sets up
the foundational tokens (CSS variables) and rewires Tailwind to use
them. After this step, the app still looks the same — no visual
changes. But all downstream work can use the tokens.

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each major section and fix errors before continuing. Commit
once at the end with message: `chore: add design tokens and Tailwind config`.

**IMPORTANT:** This prompt does NOT migrate any existing components.
Existing Tailwind classes (`text-xs`, `bg-gray-200`, `border-gray-300`,
etc.) must continue to work. We're only adding tokens and custom
utilities, not removing anything yet. Backward compatibility is
essential.

Verified: the new color utility names (`bg-page`, `text-text-primary`,
`accent`, etc.) do not collide with Tailwind defaults. Existing code
using standard Tailwind classes continues to work unchanged.

---

## STEP 1: LOAD IBM PLEX FONTS

Edit `index.html`. Add font imports inside `<head>` before the
existing `<meta>` tags for Open Graph:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap">
```

Only weights 400 and 500 are loaded — the design system forbids
other weights.

---

## STEP 2: CREATE tokens.css

Create a new file at `src/styles/tokens.css`. This is the single
source of truth for all design tokens. Every color, spacing value,
and typographic dimension lives here.

```css
/* ============================================================
 * EMOS Design Tokens
 *
 * The single source of truth for colors, spacing, typography,
 * borders, and radii. Never hardcode design values in components —
 * always reference a token from this file.
 *
 * Tokens are exposed as CSS custom properties on :root for light
 * mode, and overridden on [data-theme="dark"] for dark mode.
 * ============================================================ */

:root {
  /* -- Typography: font families -- */
  --font-sans: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

  /* -- Typography: size scale (5 sizes only) -- */
  --text-page-title: 22px;
  --text-section: 16px;
  --text-body: 14px;
  --text-label: 13px;
  --text-caption: 11px;

  /* -- Typography: line-heights -- */
  --leading-page-title: 1.2;
  --leading-section: 1.3;
  --leading-body: 1.55;
  --leading-label: 1.4;
  --leading-caption: 1.4;

  /* -- Typography: letter-spacing -- */
  --tracking-page-title: -0.01em;
  --tracking-section: -0.005em;
  --tracking-body: 0;
  --tracking-mono: 0;

  /* -- Colors: neutral / surfaces (light mode) -- */
  --color-bg-page: #FAFAF9;
  --color-bg-primary: #FFFFFF;
  --color-bg-secondary: #F4F4F2;
  --color-bg-tertiary: #E9E9E6;

  /* -- Colors: text (light mode) -- */
  --color-text-primary: #1A1A18;
  --color-text-secondary: #5F5E5A;
  --color-text-tertiary: #8B8A83;
  --color-text-on-accent: #FFFFFF;

  /* -- Colors: borders (light mode) -- */
  --color-border-tertiary: rgba(0, 0, 0, 0.08);
  --color-border-secondary: rgba(0, 0, 0, 0.15);
  --color-border-primary: rgba(0, 0, 0, 0.25);

  /* -- Colors: accent (user-configurable; default ink blue) --
   *
   * NOTE: --color-accent is the single accent color used for:
   *   - Primary buttons
   *   - Selected states
   *   - Charts (primary data series)
   *   - Current-position indicators
   *   - Links and clickable text
   *
   * In the future, user settings will override these via
   * inline style on the root element. For now, the default
   * ink blue is used throughout.
   */
  --color-accent: #185FA5;
  --color-accent-hover: #0C447C;
  --color-accent-muted: rgba(24, 95, 165, 0.08);
  --color-accent-border: rgba(24, 95, 165, 0.2);

  /* -- Colors: semantic (light mode) --
   *
   * Four semantic states only: success, warning, danger, info.
   * Each has a subtle background tint (50-stop) and a readable
   * text color (800-stop).
   */
  --color-success-bg: #EAF3DE;
  --color-success-text: #27500A;
  --color-success-border: #97C459;

  --color-warning-bg: #FAEEDA;
  --color-warning-text: #633806;
  --color-warning-border: #EF9F27;

  --color-danger-bg: #FCEBEB;
  --color-danger-text: #791F1F;
  --color-danger-border: #E24B4A;

  --color-info-bg: var(--color-accent-muted);
  --color-info-text: var(--color-accent-hover);
  --color-info-border: var(--color-accent-border);

  /* -- Colors: entity palette (9 ramps × 7 stops) --
   *
   * The curated palette for exercise colors, category colors,
   * phase colors, athlete colors. The coach picks from these
   * (or enters a custom hex). The system does not enforce
   * which entity gets which color.
   *
   * Reference stops: 50 = lightest fill, 400 = mid (default for
   * entity dot or accent), 600 = strong (for text on tint), 800 = darkest.
   */

  /* Blue */
  --color-blue-50: #E6F1FB;
  --color-blue-100: #B5D4F4;
  --color-blue-200: #85B7EB;
  --color-blue-400: #378ADD;
  --color-blue-600: #185FA5;
  --color-blue-800: #0C447C;
  --color-blue-900: #042C53;

  /* Teal */
  --color-teal-50: #E1F5EE;
  --color-teal-100: #9FE1CB;
  --color-teal-200: #5DCAA5;
  --color-teal-400: #1D9E75;
  --color-teal-600: #0F6E56;
  --color-teal-800: #085041;
  --color-teal-900: #04342C;

  /* Coral */
  --color-coral-50: #FAECE7;
  --color-coral-100: #F5C4B3;
  --color-coral-200: #F0997B;
  --color-coral-400: #D85A30;
  --color-coral-600: #993C1D;
  --color-coral-800: #712B13;
  --color-coral-900: #4A1B0C;

  /* Pink */
  --color-pink-50: #FBEAF0;
  --color-pink-100: #F4C0D1;
  --color-pink-200: #ED93B1;
  --color-pink-400: #D4537E;
  --color-pink-600: #993556;
  --color-pink-800: #72243E;
  --color-pink-900: #4B1528;

  /* Gray (separate from neutral — for entity use) */
  --color-gray-50: #F1EFE8;
  --color-gray-100: #D3D1C7;
  --color-gray-200: #B4B2A9;
  --color-gray-400: #888780;
  --color-gray-600: #5F5E5A;
  --color-gray-800: #444441;
  --color-gray-900: #2C2C2A;

  /* Green */
  --color-green-50: #EAF3DE;
  --color-green-100: #C0DD97;
  --color-green-200: #97C459;
  --color-green-400: #639922;
  --color-green-600: #3B6D11;
  --color-green-800: #27500A;
  --color-green-900: #173404;

  /* Amber */
  --color-amber-50: #FAEEDA;
  --color-amber-100: #FAC775;
  --color-amber-200: #EF9F27;
  --color-amber-400: #BA7517;
  --color-amber-600: #854F0B;
  --color-amber-800: #633806;
  --color-amber-900: #412402;

  /* Red */
  --color-red-50: #FCEBEB;
  --color-red-100: #F7C1C1;
  --color-red-200: #F09595;
  --color-red-400: #E24B4A;
  --color-red-600: #A32D2D;
  --color-red-800: #791F1F;
  --color-red-900: #501313;

  /* Purple */
  --color-purple-50: #EEEDFE;
  --color-purple-100: #CECBF6;
  --color-purple-200: #AFA9EC;
  --color-purple-400: #7F77DD;
  --color-purple-600: #534AB7;
  --color-purple-800: #3C3489;
  --color-purple-900: #26215C;

  /* -- Spacing scale (6 stops) -- */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;

  /* -- Border radii (4 stops) -- */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* -- Work area -- */
  --work-area-max-width: 1400px;

  /* -- Focus ring -- */
  --focus-ring: 0 0 0 2px var(--color-accent-border);

  /* -- Transitions -- */
  --transition-fast: 100ms ease-out;
  --transition-base: 150ms ease-out;
  --transition-slow: 200ms ease-out;
}

/* ============================================================
 * Dark mode overrides
 * ============================================================ */

[data-theme="dark"] {
  /* Neutral surfaces */
  --color-bg-page: #0E0F0D;
  --color-bg-primary: #1A1B18;
  --color-bg-secondary: #242521;
  --color-bg-tertiary: #2F302C;

  /* Text */
  --color-text-primary: #F5F4F0;
  --color-text-secondary: #B0AEA7;
  --color-text-tertiary: #78766F;
  --color-text-on-accent: #FFFFFF;

  /* Borders */
  --color-border-tertiary: rgba(255, 255, 255, 0.08);
  --color-border-secondary: rgba(255, 255, 255, 0.15);
  --color-border-primary: rgba(255, 255, 255, 0.25);

  /* Accent — same user-chosen color, but muted alphas shift */
  --color-accent: #378ADD;
  --color-accent-hover: #85B7EB;
  --color-accent-muted: rgba(55, 138, 221, 0.12);
  --color-accent-border: rgba(55, 138, 221, 0.3);

  /* Semantic — lighter shades for dark backgrounds */
  --color-success-bg: rgba(151, 196, 89, 0.12);
  --color-success-text: #97C459;
  --color-success-border: rgba(151, 196, 89, 0.3);

  --color-warning-bg: rgba(239, 159, 39, 0.12);
  --color-warning-text: #EF9F27;
  --color-warning-border: rgba(239, 159, 39, 0.3);

  --color-danger-bg: rgba(240, 149, 149, 0.12);
  --color-danger-text: #F09595;
  --color-danger-border: rgba(240, 149, 149, 0.3);

  --color-info-bg: var(--color-accent-muted);
  --color-info-text: var(--color-accent);
  --color-info-border: var(--color-accent-border);
}

/* ============================================================
 * Base body styles
 * ============================================================ */

body {
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: var(--leading-body);
  color: var(--color-text-primary);
  background-color: var(--color-bg-page);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Tabular figures for all monospace output */
.font-mono,
code,
pre,
kbd,
samp {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
```

---

## STEP 3: IMPORT tokens.css

Edit `src/index.css` so it imports the tokens file BEFORE Tailwind's
layers:

```css
@import "./styles/tokens.css";

@tailwind base;
@tailwind components;
@tailwind utilities;
```

The order matters: tokens define CSS custom properties that Tailwind
utilities can then reference via the `theme.extend` config.

---

## STEP 4: UPDATE Tailwind config

Edit `tailwind.config.js`. Extend the theme to expose tokens as
Tailwind utilities. **Do not remove existing keyframes or animations.**
This is additive only.

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /* EMOS design system — map tokens to Tailwind utilities */
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        /* EMOS type scale — matches tokens.css */
        'page-title': ['22px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '500' }],
        'section': ['16px', { lineHeight: '1.3', letterSpacing: '-0.005em', fontWeight: '500' }],
        'body': ['14px', { lineHeight: '1.55' }],
        'label': ['13px', { lineHeight: '1.4' }],
        'caption': ['11px', { lineHeight: '1.4' }],
      },
      colors: {
        /* Semantic text colors */
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-tertiary': 'var(--color-text-tertiary)',
        'text-on-accent': 'var(--color-text-on-accent)',

        /* Semantic backgrounds */
        'bg-page': 'var(--color-bg-page)',
        'bg-primary': 'var(--color-bg-primary)',
        'bg-secondary': 'var(--color-bg-secondary)',
        'bg-tertiary': 'var(--color-bg-tertiary)',

        /* Borders */
        'border-tertiary': 'var(--color-border-tertiary)',
        'border-secondary': 'var(--color-border-secondary)',
        'border-primary': 'var(--color-border-primary)',

        /* Accent */
        'accent': 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'accent-muted': 'var(--color-accent-muted)',

        /* Semantic state colors */
        'success-bg': 'var(--color-success-bg)',
        'success-text': 'var(--color-success-text)',
        'success-border': 'var(--color-success-border)',

        'warning-bg': 'var(--color-warning-bg)',
        'warning-text': 'var(--color-warning-text)',
        'warning-border': 'var(--color-warning-border)',

        'danger-bg': 'var(--color-danger-bg)',
        'danger-text': 'var(--color-danger-text)',
        'danger-border': 'var(--color-danger-border)',

        'info-bg': 'var(--color-info-bg)',
        'info-text': 'var(--color-info-text)',
        'info-border': 'var(--color-info-border)',

        /* Entity palette — 9 ramps for exercise/category/phase colors */
        'entity-blue': {
          50: 'var(--color-blue-50)',
          100: 'var(--color-blue-100)',
          200: 'var(--color-blue-200)',
          400: 'var(--color-blue-400)',
          600: 'var(--color-blue-600)',
          800: 'var(--color-blue-800)',
          900: 'var(--color-blue-900)',
        },
        'entity-teal': {
          50: 'var(--color-teal-50)',
          100: 'var(--color-teal-100)',
          200: 'var(--color-teal-200)',
          400: 'var(--color-teal-400)',
          600: 'var(--color-teal-600)',
          800: 'var(--color-teal-800)',
          900: 'var(--color-teal-900)',
        },
        'entity-coral': {
          50: 'var(--color-coral-50)',
          100: 'var(--color-coral-100)',
          200: 'var(--color-coral-200)',
          400: 'var(--color-coral-400)',
          600: 'var(--color-coral-600)',
          800: 'var(--color-coral-800)',
          900: 'var(--color-coral-900)',
        },
        'entity-pink': {
          50: 'var(--color-pink-50)',
          100: 'var(--color-pink-100)',
          200: 'var(--color-pink-200)',
          400: 'var(--color-pink-400)',
          600: 'var(--color-pink-600)',
          800: 'var(--color-pink-800)',
          900: 'var(--color-pink-900)',
        },
        'entity-gray': {
          50: 'var(--color-gray-50)',
          100: 'var(--color-gray-100)',
          200: 'var(--color-gray-200)',
          400: 'var(--color-gray-400)',
          600: 'var(--color-gray-600)',
          800: 'var(--color-gray-800)',
          900: 'var(--color-gray-900)',
        },
        'entity-green': {
          50: 'var(--color-green-50)',
          100: 'var(--color-green-100)',
          200: 'var(--color-green-200)',
          400: 'var(--color-green-400)',
          600: 'var(--color-green-600)',
          800: 'var(--color-green-800)',
          900: 'var(--color-green-900)',
        },
        'entity-amber': {
          50: 'var(--color-amber-50)',
          100: 'var(--color-amber-100)',
          200: 'var(--color-amber-200)',
          400: 'var(--color-amber-400)',
          600: 'var(--color-amber-600)',
          800: 'var(--color-amber-800)',
          900: 'var(--color-amber-900)',
        },
        'entity-red': {
          50: 'var(--color-red-50)',
          100: 'var(--color-red-100)',
          200: 'var(--color-red-200)',
          400: 'var(--color-red-400)',
          600: 'var(--color-red-600)',
          800: 'var(--color-red-800)',
          900: 'var(--color-red-900)',
        },
        'entity-purple': {
          50: 'var(--color-purple-50)',
          100: 'var(--color-purple-100)',
          200: 'var(--color-purple-200)',
          400: 'var(--color-purple-400)',
          600: 'var(--color-purple-600)',
          800: 'var(--color-purple-800)',
          900: 'var(--color-purple-900)',
        },
      },
      spacing: {
        /* EMOS spacing scale — matches tokens.css */
        /* Use Tailwind's default spacing for backward compat,
         * add named EMOS tokens alongside. */
        'emos-xs': 'var(--space-xs)',
        'emos-sm': 'var(--space-sm)',
        'emos-md': 'var(--space-md)',
        'emos-lg': 'var(--space-lg)',
        'emos-xl': 'var(--space-xl)',
        'emos-2xl': 'var(--space-2xl)',
      },
      borderRadius: {
        'emos-sm': 'var(--radius-sm)',
        'emos-md': 'var(--radius-md)',
        'emos-lg': 'var(--radius-lg)',
        'emos-xl': 'var(--radius-xl)',
      },
      borderWidth: {
        'hairline': '0.5px',
      },
      maxWidth: {
        'work-area': 'var(--work-area-max-width)',
      },
      boxShadow: {
        'focus': 'var(--focus-ring)',
        /* Deliberately minimal — EMOS uses borders, not shadows */
      },
      transitionDuration: {
        'fast': '100ms',
        'base': '150ms',
        'slow': '200ms',
      },
      keyframes: {
        /* KEEP EXISTING KEYFRAMES — do not remove */
        'backdrop-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'dialog-in': {
          '0%': { opacity: '0', transform: 'scale(0.96) translateY(4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'sidebar-in': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'pulse-value': {
          '0%, 100%': { color: 'inherit' },
          '50%': { color: '#378ADD' },
        },
      },
      animation: {
        /* KEEP EXISTING ANIMATIONS — do not remove */
        'backdrop-in': 'backdrop-in 150ms ease-out',
        'dialog-in': 'dialog-in 150ms ease-out',
        'sidebar-in': 'sidebar-in 200ms ease-out',
        'pulse-value': 'pulse-value 400ms ease-in-out',
      },
    },
  },
  plugins: [],
};
```

---

## STEP 5: VERIFY BACKWARD COMPATIBILITY

Run the build. The existing app must still compile and look identical.

```bash
npm run build
```

If any errors appear, they're likely TypeScript path issues from the
new tokens.css import. Fix by ensuring the path is correct in
`src/index.css`:

```css
@import "./styles/tokens.css";
```

(Note: `./styles/` — relative path from `src/index.css`.)

The dev server should start cleanly, and the existing pages should
look exactly as before. No visual regression is acceptable in this step.

Test by running:
```bash
npm run dev
```

Navigate through a few pages (dashboard, macro cycles, weekly planner,
exercise library). Everything should render identically to before.

---

## STEP 6: ADD A SMOKE TEST FILE

Create a minimal test file at `src/styles/README.md` to document the
system:

```markdown
# EMOS Design Tokens

All design tokens live in `tokens.css`. This is the single source of
truth for colors, spacing, typography, borders, and radii.

## Usage

In CSS:
```css
.my-component {
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  padding: var(--space-lg);
  border-radius: var(--radius-md);
}
```

In Tailwind:
```tsx
<div className="bg-primary text-text-primary p-emos-lg rounded-emos-md">
```

## Rules

1. **Never hardcode colors** in components. Use tokens.
2. **Never use arbitrary sizes** like `text-[9px]`. Use the scale.
3. **Two weights only**: 400 regular, 500 medium.
4. **Sentence case** everywhere.
5. **Numbers always in mono** with `font-mono` class.

See `/mnt/user-data/uploads/EMOS_DESIGN_SYSTEM.md` for the full spec.
```

---

## STEP 7: FINAL BUILD + COMMIT

```bash
npm run build
```

Must pass with no errors.

Commit all changes:
```bash
git add -A
git commit -m "chore: add design tokens and Tailwind config

- Load IBM Plex Sans and IBM Plex Mono fonts in index.html
- Create src/styles/tokens.css with complete design token set
  (colors, typography, spacing, radii, semantic states)
- Extend Tailwind config to expose tokens as utilities:
  - fontFamily.sans/mono → Plex
  - fontSize.page-title/section/body/label/caption
  - colors.bg-*, text-*, border-*, accent, success/warning/danger/info
  - colors.entity-* (9 ramps for exercise/category/phase colors)
  - spacing.emos-xs through emos-2xl
  - borderRadius.emos-sm through emos-xl
- Dark mode variants via [data-theme=\"dark\"]
- Existing Tailwind utilities preserved — fully backward compatible
- No visual changes to existing pages"
```

---

## VERIFICATION CHECKLIST

Before declaring complete:

1. ✅ `npm run build` passes with no errors
2. ✅ `npm run dev` starts cleanly
3. ✅ Existing pages look identical (visually regression-tested)
4. ✅ IBM Plex fonts load (check Network tab — `fonts.googleapis.com`
   request succeeds)
5. ✅ `tokens.css` exists at `src/styles/tokens.css`
6. ✅ Tailwind config has new entries (fontFamily, colors, etc.)
   AND keeps existing keyframes/animations
7. ✅ Commit created with proper message

## NEXT STEP

Once this is committed, Prompt 2 will create the `/system` style
guide page that renders every primitive using the tokens. This is
the visual validation surface.

Prompt 3 will create the primitives library in `src/components/ui/`.
