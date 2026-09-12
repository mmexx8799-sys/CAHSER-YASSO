/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.tsx",
    "./index.tsx",
    "./{pages,components,contexts,stores,hooks}/**/*.{ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'sans-serif'],
        mono: ['monospace'],
      },
      colors: {
        primary: {
          "50": "#eff6ff",
          "100": "#dbeafe",
          "200": "#bfdbfe",
          "300": "#93c5fd",
          "400": "#60a5fa",
          "500": "#3b82f6",
          "600": "#2563eb",
          "700": "#1d4ed8",
          "800": "#1e40af",
          "900": "#1e3a8a",
          "950": "#172554"
        },
        receipt: {
          accent: "#7A2036",
          "accent-dark": "#F0B9C5",
          paper: "#FFFFFF",
          "paper-dark": "#1E2430",
          muted: "#6B7280",
          "muted-dark": "#9C978A",
          hair: "#E4E1D8",
          "hair-dark": "#3A4150"
        }
      }
    },
  },
  plugins: [],
}