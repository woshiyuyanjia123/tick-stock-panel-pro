/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        terminal: {
          obsidian: '#070a10',
          bg: '#0b0f17',
          panel: '#111622',
          card: '#141a26',
          hover: '#1c2436',
          border: '#1f293d',
          up: '#ef4444',
          down: '#10b981',
          accent: '#3b82f6',
          cyan: '#22d3ee',
          gold: '#f59e0b',
          ext: '#7c3aed',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
