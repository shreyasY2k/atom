/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base:    '#080810',
          surface: '#0f0f1a',
          raised:  '#16162a',
          border:  '#1e1e35',
          hover:   '#22223a',
        },
        accent: {
          DEFAULT: '#7c3aed',
          light:   '#8b5cf6',
          dim:     '#1e1040',
        },
        node: {
          agent:  { bg: '#1a0a35', border: '#7c3aed', text: '#c4b5fd' },
          http:   { bg: '#0a1a2e', border: '#0ea5e9', text: '#7dd3fc' },
          dec:    { bg: '#1a1200', border: '#d97706', text: '#fcd34d' },
          human:  { bg: '#001a12', border: '#059669', text: '#6ee7b7' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
