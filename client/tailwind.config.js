/**
 * @file tailwind.config.js
 * @description Tailwind CSS configuration — content globs and the "Nexus Console" design tokens: a warm
 * graphite neutral ramp, surfaces, a CSS-variable accent, and six meaning-bound colour families
 * (clay, lilac, glacier for the three quota pools; mint, amber, coral for status) generated in OKLCH.
 * Every legacy Tailwind hue the pages use (violet, fuchsia, cyan, emerald, ...) is remapped onto one of
 * those families so the whole app shares one calm palette without per-file class churn.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

/** Ramp stops in Tailwind order. */
const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
/** OKLCH lightness per stop. */
const LIGHTNESS = [0.97, 0.93, 0.87, 0.8, 0.72, 0.64, 0.55, 0.46, 0.37, 0.28, 0.21];
/** Chroma weight per stop: full saturation sits in the middle of the ramp. */
const CHROMA_WEIGHT = [0.18, 0.35, 0.6, 0.85, 1, 1, 0.92, 0.8, 0.62, 0.45, 0.32];

/**
 * Convert an OKLCH colour to a gamut-mapped sRGB hex string (chroma is reduced until it fits).
 *
 * @param {number} l - Lightness 0..1.
 * @param {number} c - Chroma.
 * @param {number} h - Hue in degrees.
 * @returns {string} Hex colour.
 */
function oklchToHex(l, c, h) {
  for (let chroma = c; chroma >= 0; chroma -= 0.002) {
    const a = chroma * Math.cos((h * Math.PI) / 180);
    const b = chroma * Math.sin((h * Math.PI) / 180);
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [
      4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
      -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
      -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    ];
    if (lin.every((v) => v >= -0.0001 && v <= 1.0001)) {
      return (
        "#" +
        lin
          .map((v) => {
            const x = Math.min(1, Math.max(0, v));
            const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
            return Math.round(srgb * 255)
              .toString(16)
              .padStart(2, "0");
          })
          .join("")
      );
    }
  }
  return "#000000";
}

/**
 * Build a 50..950 ramp for one hue.
 *
 * @param {number} hue - OKLCH hue in degrees.
 * @param {number} chroma - Peak chroma.
 * @returns {Record<number, string>} Tailwind colour scale.
 */
function ramp(hue, chroma) {
  return Object.fromEntries(
    STOPS.map((stop, i) => [stop, oklchToHex(LIGHTNESS[i], chroma * CHROMA_WEIGHT[i], hue)])
  );
}

/** Warm graphite neutrals shared by the `gray`, `slate`, `zinc`, `neutral`, and `stone` keys. */
const GRAPHITE = {
  50: "#f4f4f5",
  100: "#e7e7e9",
  200: "#d2d2d6",
  300: "#b2b2b8",
  400: "#8d8d95",
  500: "#6c6c74",
  600: "#505057",
  700: "#3a3a40",
  800: "#26262b",
  900: "#18181b",
  950: "#0f0f11",
};

// Meaning-bound families. Pools: clay = Claude Direct (Anthropic), lilac = AGY-Claude,
// glacier = AGY-Gemini. Status: mint = working/success, amber = waiting/needs you, coral = error.
const CLAY = ramp(48, 0.13);
const LILAC = ramp(292, 0.11);
const GLACIER = ramp(238, 0.1);
const MINT = ramp(162, 0.12);
const AMBER = ramp(82, 0.13);
const CORAL = ramp(24, 0.15);

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gray: GRAPHITE,
        slate: GRAPHITE,
        zinc: GRAPHITE,
        neutral: GRAPHITE,
        stone: GRAPHITE,
        clay: CLAY,
        orange: CLAY,
        lilac: LILAC,
        violet: LILAC,
        purple: LILAC,
        fuchsia: LILAC,
        indigo: LILAC,
        glacier: GLACIER,
        cyan: GLACIER,
        sky: GLACIER,
        blue: GLACIER,
        mint: MINT,
        emerald: MINT,
        green: MINT,
        teal: MINT,
        lime: MINT,
        amber: AMBER,
        yellow: AMBER,
        coral: CORAL,
        red: CORAL,
        rose: CORAL,
        pink: CORAL,
        surface: {
          0: "#0f0f11",
          1: "#141416",
          2: "#19191c",
          3: "#1f1f23",
          4: "#26262b",
          5: "#2e2e34",
        },
        border: {
          DEFAULT: "#26262b",
          light: "#33333a",
        },
        // The interactive accent lives in CSS variables (index.css) so the brand colour can be
        // tuned in one place; `<alpha-value>` keeps opacity modifiers such as `bg-accent/15` working.
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          muted: "rgb(var(--accent) / 0.14)",
          ink: "rgb(var(--accent-ink) / <alpha-value>)",
        },
        pool: {
          claude: CLAY[400],
          agyclaude: LILAC[400],
          gemini: GLACIER[400],
        },
      },
      boxShadow: {
        hairline: "inset 0 1px 0 rgba(255, 255, 255, 0.025)",
        overlay: "0 16px 48px rgba(0, 0, 0, 0.5)",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.24s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-up": "slideUp 0.24s cubic-bezier(0.16, 1, 0.3, 1)",
        "row-flash": "rowFlash 1.2s ease-out",
        "drawer-in": "drawerIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        "pop-in": "popIn 0.14s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        rowFlash: {
          "0%": { backgroundColor: "rgb(var(--accent) / 0.12)" },
          "100%": { backgroundColor: "transparent" },
        },
        drawerIn: {
          "0%": { opacity: "0", transform: "translateX(24px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        popIn: {
          "0%": { opacity: "0", transform: "translateY(-4px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
