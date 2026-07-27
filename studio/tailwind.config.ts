import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

// Shared dark palette + JetBrains Mono stack for Studio's tracker and coding
// surfaces.
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        pane: {
          bg: "#0a0a0a",
          panel: "#111317",
          border: "#2a2f3a",
          title: "#1f2530",
        },
        focus: {
          accent: "#7aa2f7",
        },
        selection: {
          bg: "#2d3a5a",
        },
        text: {
          primary: "#d6deeb",
          // F3: a distinct mid-tone for eyebrow/section labels, keys and counts
          // — was carried by text-muted/70 (near-invisible). Brighter than muted
          // so labels read without shouting.
          secondary: "#9aa5b8",
          muted: "#7a8599",
        },
        // Lifecycle/attention palette (#504/#511) used by Studio agent state.
        lifecycle: {
          active: "#7dcfff",
          attention: "#e0af68",
          danger: "#f7768e",
          idle: "#7aa2f7",
          success: "#9ece6a",
        },
      },
      fontFamily: {
        // F1: split roles. Proportional sans for everything you read; mono kept
        // only for KEY-N identifiers and code. Both self-hosted (Fontsource), so
        // no external request and the dark sibling palette is untouched.
        sans: [
          "Hanken Grotesk Variable",
          "IBM Plex Sans",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono Variable",
          "JetBrains Mono",
          "Fira Code",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      // F2: one 6-step scale (base 14px), replacing the 9.5–19px half-pixel
      // jungle. Tokens carry size + line-height only — weight stays per-use.
      fontSize: {
        xs: ["11px", { lineHeight: "1.45" }],
        sm: ["12.5px", { lineHeight: "1.5" }],
        base: ["14px", { lineHeight: "1.55" }],
        md: ["16px", { lineHeight: "1.4" }],
        lg: ["20px", { lineHeight: "1.3" }],
        xl: ["24px", { lineHeight: "1.25" }],
      },
    },
  },
  // @tailwindcss/typography (#691): Muxed's ported DocTab/DetailsTab use the
  // `prose` classes; Studio's config previously had no plugins.
  plugins: [typography],
};

export default config;
