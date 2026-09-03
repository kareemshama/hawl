/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1b1f1c",
        paper: "#f7f5ef",
        sand: {
          50: "#faf9f5",
          100: "#f1eee5",
          200: "#e5e0d2",
          300: "#cfc7b3",
          400: "#a89d84",
        },
        moss: {
          50: "#eef4ef",
          100: "#d9e7dc",
          200: "#b6d1bd",
          400: "#5f8f6c",
          600: "#2f6a44",
          700: "#24523a",
          800: "#1a3b2a",
        },
        gold: {
          100: "#f7ead0",
          400: "#d8b35d",
          600: "#a97f1f",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
