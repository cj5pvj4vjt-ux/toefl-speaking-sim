/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#060A15',
          900: '#0A0F1F',
          850: '#0E1526',
          800: '#141C33',
          750: '#1A2440',
          700: '#22304F',
          600: '#33456E'
        },
        brand: {
          50: '#EEF2FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA'
        },
        aqua: {
          300: '#67E8F9',
          400: '#22D3EE',
          500: '#06B6D4'
        },
        good: '#34D399',
        warn: '#FBBF24',
        bad: '#F87171'
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'Inter',
          'Helvetica Neue',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif'
        ],
        mono: ['SF Mono', 'ui-monospace', 'Menlo', 'monospace']
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 32px -12px rgba(0,0,0,0.65)',
        glow: '0 0 0 1px rgba(99,102,241,0.35), 0 0 32px -6px rgba(99,102,241,0.45)',
        rec: '0 0 0 0 rgba(248,113,113,0.7)'
      },
      keyframes: {
        pulseRec: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.25' }
        },
        floatIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' }
        }
      },
      animation: {
        pulseRec: 'pulseRec 1.1s ease-in-out infinite',
        floatIn: 'floatIn 220ms ease-out both',
        shimmer: 'shimmer 1.6s linear infinite'
      }
    }
  },
  plugins: []
}
