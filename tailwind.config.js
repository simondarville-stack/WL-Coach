/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
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
        'backdrop-in': 'backdrop-in 150ms ease-out',
        'dialog-in': 'dialog-in 150ms ease-out',
        'sidebar-in': 'sidebar-in 200ms ease-out',
        'pulse-value': 'pulse-value 400ms ease-in-out',
      },
    },
  },
  plugins: [],
};
