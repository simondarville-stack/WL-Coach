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
