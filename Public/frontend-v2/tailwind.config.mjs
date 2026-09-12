// Tailwind configuration for the v2 public portal.
//
// WHY darkMode: 'class'
// The header has an explicit light/dark toggle, so we cannot rely on the OS
// 'media' strategy alone — the user's choice must win and persist. The 'class'
// strategy means dark styling activates only when <html> carries the `dark`
// class, which the no-flash head script (in Layout.astro) sets from localStorage
// or prefers-color-scheme BEFORE first paint. This is what makes `dark:` variants
// respond to the toggle rather than to the OS setting.
//
// BRAND PALETTE
// Saffron #F27A1A is the portal's signature accent (carried over from the old
// style.css visual language). The status colours match the semantics used across
// the ledger/loan views so components can reference brand tokens instead of raw
// hex, keeping the design consistent as pages are added in later phases.

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Saffron ramp around the #F27A1A primary accent.
          50: '#FEF3E7',
          100: '#FDE1C4',
          200: '#FBC489',
          300: '#F8A64E',
          400: '#F58C28',
          500: '#F27A1A', // primary — the portal's signature saffron
          600: '#D3630F',
          700: '#A94D0C',
          800: '#7E3A0A',
          900: '#552706',
        },
        success: '#10B981',
        danger: '#EF4444',
        warning: '#F59E0B',
      },
      fontFamily: {
        // Inter is the portal's UI font; the generic stack keeps text readable
        // before the web font loads (and covers Devanagari via system fonts).
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
