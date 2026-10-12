import { editionDefine } from "./scripts/edition-build-policy.mjs";
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// The default suite pins core; vitest.pocock.config.ts runs the Pocock edition.
export default defineConfig({
  define: editionDefine({ TICKETRY_EDITION: "core" }),
  plugins: [react()],
  // Mirrors vite.config.ts: one CodeMirror instance, or the dark theme Studio
  // hands to MDXEditor's code blocks fails CodeMirror's extension checks.
  resolve: {
    dedupe: [
      "@codemirror/language",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/highlight",
    ],
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    // Externalized deps bypass `resolve.dedupe`, so MDXEditor and CodeMirror
    // are inlined to keep the dedupe above effective under Vitest too.
    server: {
      deps: { inline: [/@mdxeditor/, /codemirror/, /cm6-theme/, /@lezer/] },
    },
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "src/test/overhaulPocock*Acceptance.test.tsx"],
  },
});
