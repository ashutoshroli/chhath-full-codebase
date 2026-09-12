
export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      screens: {
        xs: '475px',
      },
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
          900: '#552706',
        },
        success: '#10B981',
        danger: '#EF4444',
        warning: '#F59E0B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
