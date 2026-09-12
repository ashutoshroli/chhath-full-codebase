/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './privacy.html', './terms.html', './script.js'],
  theme: {
    extend: {
      colors: {
        // Matches the old :root CSS variables 1:1 so the redesign keeps the
        // same brand colors without any custom CSS file.
        saffron: { DEFAULT: '#F27A1A', light: '#FFEDD5' },
        offwhite: '#F8F9FA',
      },
      boxShadow: {
        card: '0 4px 6px -1px rgba(0,0,0,0.05)',
      },
      keyframes: {
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        fade: 'fade 0.3s ease-in-out',
      },
    },
  },
  plugins: [],
};
