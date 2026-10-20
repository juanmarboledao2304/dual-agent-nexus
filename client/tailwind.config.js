/**
 * @file tailwind.config.js
 * @description Tailwind CSS configuration — content globs and the "Nexus Signal" design tokens (graphite neutrals, surfaces, Ember accent, pool colors).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

/** Graphite neutral ramp shared by the `gray` and `slate` color keys. */
const GRAPHITE = {
  50: "#f5f6f8",
  100: "#e8eaee",
  200: "#d3d7de",
  300: "#b3b9c4",
  400: "#8c93a0",
  500: "#6a717d",
  600: "#4d535d",
  700: "#373c44",
  800: "#23272d",
  900: "#15171b",
  950: "#0b0c0f",
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // "Nexus Signal" graphite neutral ramp. Both `gray` and `slate` map to it so
        // every page shares one cool-neutral scale.
        gray: GRAPHITE,
        slate: GRAPHITE,
        surface: {
          0: "#08090b",
          1: "#0e0f12",
          2: "#131519",
          3: "#181b20",
          4: "#20242a",
          5: "#292e35",
        },
        border: {
          DEFAULT: "#22262c",
          light: "#2f343c",
        },
        // "Ember": the single chromatic action color.
        accent: {
          DEFAULT: "#ff8a3d",
          hover: "#ffa466",
          muted: "rgba(255, 138, 61, 0.14)",
          ink: "#140a03",
        },
        pool: {
          claude: "#ff8a3d",
          agyclaude: "#a78bfa",
          gemini: "#5ab8ff",
        },
      },
      boxShadow: {
        hairline: "inset 0 1px 0 rgba(255, 255, 255, 0.03)",
        overlay: "0 12px 40px rgba(0, 0, 0, 0.55)",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
