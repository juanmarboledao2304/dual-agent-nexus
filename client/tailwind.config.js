/**
 * @file tailwind.config.js
 * @description Tailwind CSS configuration — content globs and the themeable "Nexus Console" design tokens.
 * Every colour (neutrals, surfaces, borders, accent, paper, and six meaning-bound families: clay, lilac,
 * glacier for the three quota pools; mint, amber, coral for status) is a CSS variable generated in OKLCH
 * for two themes: "console" (warm graphite, ember accent) and "duet" (plum carbon, vermilion and
 * violet/cyan inks, paper accent). Legacy Tailwind hues the pages still use (violet, fuchsia, cyan,
 * emerald, ...) are remapped onto those families so the whole app shares one calm palette.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import plugin from "tailwindcss/plugin";

/** Ramp stops in Tailwind order. */
const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
/** OKLCH lightness per stop. */
const LIGHTNESS = [0.97, 0.93, 0.87, 0.8, 0.72, 0.64, 0.55, 0.46, 0.37, 0.28, 0.21];
/** Chroma weight per stop: full saturation sits in the middle of the ramp. */
const CHROMA_WEIGHT = [0.18, 0.35, 0.6, 0.85, 1, 1, 0.92, 0.8, 0.62, 0.45, 0.32];

/**
 * Convert an OKLCH colour to gamut-mapped sRGB channels (chroma is reduced until it fits).
 *
 * @param {number} l - Lightness 0..1.
 * @param {number} c - Chroma.
 * @param {number} h - Hue in degrees.
 * @returns {string} Space-separated "R G B" for `rgb(var(--x) / alpha)`.
 */
function oklchToRgb(l, c, h) {
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
      return lin
        .map((v) => {
          const x = Math.min(1, Math.max(0, v));
          const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
          return Math.round(srgb * 255);
        })
        .join(" ");
    }
  }
  return "0 0 0";
}

/**
 * Build CSS variables for a 50..950 ramp.
 *
 * @param {string} name - Variable prefix.
 * @param {(i: number) => [number, number]} hueChroma - Hue and peak chroma for stop index i.
 * @returns {Record<string, string>} `--name-stop` variables.
 */
function rampVars(name, hueChroma) {
  return Object.fromEntries(
    STOPS.map((stop, i) => {
      const [h, c] = hueChroma(i);
      return [`--${name}-${stop}`, oklchToRgb(LIGHTNESS[i], c * CHROMA_WEIGHT[i], h)];
    })
  );
}

/**
 * Neutral ramp: low, near-constant chroma (no chroma weighting) so text stays neutral.
 *
 * @param {(i: number) => [number, number]} hueChroma - Hue and chroma for stop index i.
 * @returns {Record<string, string>} `--gray-stop` variables.
 */
function neutralVars(hueChroma) {
  return Object.fromEntries(
    STOPS.map((stop, i) => {
      const [h, c] = hueChroma(i);
      return [`--gray-${stop}`, oklchToRgb(LIGHTNESS[i], c, h)];
    })
  );
}

/** Theme definitions: meaning-bound families keep their names; only hue and chroma change. */
const THEMES = {
  console: {
    gray: () => [70, 0.005],
    surfaces: { l: [0.17, 0.195, 0.22, 0.25, 0.28, 0.315], h: 70, c: 0.004 },
    borders: { l: [0.285, 0.33], h: 70, c: 0.005 },
    families: {
      clay: [48, 0.13],
      lilac: [292, 0.11],
      glacier: [238, 0.1],
      mint: [162, 0.12],
      amber: [82, 0.13],
      coral: [24, 0.15],
    },
    accent: ["255 138 61", "255 164 102", "20 10 3"],
    paper: ["236 236 239", "15 15 17"],
  },
  duet: {
    // Warm paper-white text, plum carbon shadows: hue slides from 75 (light) to 300 (dark).
    gray: (i) => (i <= 4 ? [75, 0.016] : i <= 6 ? [320, 0.018] : [300, 0.022]),
    surfaces: { l: [0.2, 0.225, 0.255, 0.285, 0.315, 0.35], h: 300, c: 0.02 },
    borders: { l: [0.32, 0.38], h: 300, c: 0.026 },
    families: {
      clay: [36, 0.19],
      lilac: [292, 0.17],
      glacier: [215, 0.12],
      mint: [152, 0.1],
      amber: [78, 0.12],
      coral: [20, 0.17],
    },
    accent: ["243 235 221", "255 248 236", "28 24 35"],
    paper: ["243 235 221", "28 24 35"],
  },
};

/**
 * Every CSS variable for one theme.
 *
 * @param {typeof THEMES.console} theme - Theme definition.
 * @returns {Record<string, string>} Variables.
 */
function themeVars(theme) {
  const vars = { ...neutralVars(theme.gray) };
  for (const [name, [h, c]] of Object.entries(theme.families)) {
    Object.assign(
      vars,
      rampVars(name, () => [h, c])
    );
  }
  theme.surfaces.l.forEach((l, i) => {
    vars[`--surface-${i}`] = oklchToRgb(l, theme.surfaces.c, theme.surfaces.h);
  });
  vars["--border"] = oklchToRgb(theme.borders.l[0], theme.borders.c, theme.borders.h);
  vars["--border-light"] = oklchToRgb(theme.borders.l[1], theme.borders.c, theme.borders.h);
  [vars["--accent"], vars["--accent-hover"], vars["--accent-ink"]] = theme.accent;
  [vars["--paper"], vars["--paper-ink"]] = theme.paper;
  return vars;
}

/** Tailwind colour value bound to a CSS variable (opacity modifiers keep working). */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
/** A full 50..950 scale bound to `--name-*` variables. */
const scale = (name) => Object.fromEntries(STOPS.map((s) => [s, v(`${name}-${s}`)]));

const GRAY = scale("gray");
const CLAY = scale("clay");
const LILAC = scale("lilac");
const GLACIER = scale("glacier");
const MINT = scale("mint");
const AMBER = scale("amber");
const CORAL = scale("coral");

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gray: GRAY,
        slate: GRAY,
        zinc: GRAY,
        neutral: GRAY,
        stone: GRAY,
        // Pools: clay = Claude Direct (Anthropic), lilac = AGY-Claude, glacier = AGY-Gemini.
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
        // Status: mint = working/success, amber = waiting/needs you, coral = error.
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
        surface: Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [i, v(`surface-${i}`)])),
        border: {
          DEFAULT: v("border"),
          light: v("border-light"),
        },
        accent: {
          DEFAULT: v("accent"),
          hover: v("accent-hover"),
          muted: "rgb(var(--accent) / 0.14)",
          ink: v("accent-ink"),
        },
        paper: {
          DEFAULT: v("paper"),
          ink: v("paper-ink"),
        },
        pool: {
          claude: v("clay-400"),
          agyclaude: v("lilac-400"),
          gemini: v("glacier-400"),
        },
      },
      boxShadow: {
        hairline: "inset 0 1px 0 rgba(255, 255, 255, 0.025)",
        overlay: "0 16px 48px rgba(0, 0, 0, 0.5)",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
        pixel: ["Departure Mono", "JetBrains Mono", "monospace"],
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
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ":root": themeVars(THEMES.console),
        ':root[data-theme="duet"]': themeVars(THEMES.duet),
      });
    }),
  ],
};
