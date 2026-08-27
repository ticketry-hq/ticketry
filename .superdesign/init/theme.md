# Theme

## Compact token summary

- Background: `#0a0a0a`
- Panel: `#111317`
- Border: `#2a2f3a`
- Raised/title strip: `#1f2530`
- Primary text: `#d6deeb`
- Secondary text: `#9aa5b8`
- Muted text: `#7a8599`
- Focus accent: `#7aa2f7`
- Selection: `#2d3a5a`
- Success: `#9ece6a`; attention: `#e0af68`; danger: `#f7768e`; active cyan: `#7dcfff`
- Reading font: Hanken Grotesk Variable. Code and identifiers: JetBrains Mono Variable.
- Type scale: 11, 12.5, 14, 16, 20, 24px.
- Corners: always square. No border radius.
- Motion: restrained 150–220ms color, opacity, and position transitions. Respect reduced motion.
- Desktop-first dense layout. Thin 1px borders divide panels; hierarchy comes from tone and spacing, not cards floating in space.

## Raw source

### `studio/tailwind.config.ts`

```ts
const config = {
  darkMode: "class",
  theme: { extend: {
    colors: {
      pane: { bg: "#0a0a0a", panel: "#111317", border: "#2a2f3a", title: "#1f2530" },
      focus: { accent: "#7aa2f7" },
      selection: { bg: "#2d3a5a" },
      text: { primary: "#d6deeb", secondary: "#9aa5b8", muted: "#7a8599" },
      lifecycle: { active: "#7dcfff", attention: "#e0af68", danger: "#f7768e", idle: "#7aa2f7", success: "#9ece6a" },
    },
    fontFamily: {
      sans: ["Hanken Grotesk Variable", "system-ui", "sans-serif"],
      mono: ["JetBrains Mono Variable", "ui-monospace", "monospace"],
    },
    fontSize: { xs: ["11px", "1.45"], sm: ["12.5px", "1.5"], base: ["14px", "1.55"], md: ["16px", "1.4"], lg: ["20px", "1.3"], xl: ["24px", "1.25"] },
  } },
};
```

### `studio/src/app/styles/tailwind.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
@layer base {
  *, *::before, *::after { border-radius: 0 !important; }
  html, body, #root { height: 100%; }
  body { @apply bg-pane-bg text-text-primary font-sans text-base; margin: 0; -webkit-font-smoothing: antialiased; }
}
```
