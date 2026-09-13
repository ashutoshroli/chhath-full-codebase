import type { Config } from 'tailwindcss';

// darkMode 'class' is REQUIRED for the manual light/dark toggle (persisted in
// localStorage, applied to <html> before first paint by the no-flash script in
// app.html). Brand ramp matches the current portal accent (#F27A1A) so the
// redesign stays on-brand across all three existing frontends.
export default {
  darkMode: 'class',
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      screens: { xs: '400px' },
      colors: {
        brand: {
          50: '#FEF3E7',
          100: '#FDE1C4',
          200: '#FBC489',
          300: '#F8A64E',
          400: '#F58C28',
          500: '#F27A1A',
          600: '#D3630F',
          700: '#A94D0C',
          800: '#7E3A0A',
          900: '#552706'
        },
        gold: '#F5B840',
        navy: '#0B2447',
        ink: '#0b1020',
        success: '#10B981',
        info: '#3B82F6',
        danger: '#EF4444',
        warning: '#F59E0B'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        hand: ['Kalam', 'cursive']
      },
      boxShadow: {
        card: '0 10px 30px -12px rgba(15,23,42,.25)',
        'card-dark': '0 14px 34px -12px rgba(0,0,0,.6)',
        glow: '0 0 24px -4px rgba(242,122,26,.5)'
      },
      keyframes: {
        sunrise: {
          '0%,100%': { transform: 'translate(-50%, 8px)', opacity: '0.92' },
          '50%': { transform: 'translate(-50%, -8px)', opacity: '1' }
        },
        floatUp: {
          '0%,100%': { transform: 'translateY(0)', opacity: '0.5' },
          '50%': { transform: 'translateY(-14px)', opacity: '1' }
        },
        ripple: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(80px)' } },
        pulseDot: { '50%': { boxShadow: '0 0 0 8px rgba(16,185,129,0)' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        aurora: {
          '0%,100%': { transform: 'translate(0,0) scale(1)', opacity: '0.7' },
          '33%': { transform: 'translate(6%,-4%) scale(1.15)', opacity: '0.9' },
          '66%': { transform: 'translate(-5%,5%) scale(1.05)', opacity: '0.8' }
        }
      },
      animation: {
        sunrise: 'sunrise 9s ease-in-out infinite',
        floatUp: 'floatUp 7s ease-in-out infinite',
        ripple: 'ripple 6s linear infinite',
        pulseDot: 'pulseDot 1.6s infinite',
        marquee: 'marquee var(--marquee-duration, 40s) linear infinite',
        aurora: 'aurora 18s ease-in-out infinite'
      }
    }
  },
  plugins: []
} satisfies Config;
