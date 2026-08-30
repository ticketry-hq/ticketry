import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { devProxy } from "./vite.proxy";
import { webFrontendLogPlugin } from "./scripts/web-frontend-log-plugin.mjs";

// Studio dev server (:5174) and its single default-entry production build.
export default defineConfig({
  plugins: [react(), webFrontendLogPlugin()],
  resolve: {
    // CodeMirror packages are deduped so the dark theme Studio passes into
    // MDXEditor's code blocks shares the single @codemirror/state instance the
    // editor itself loaded — two copies break CodeMirror's extension checks.
    dedupe: [
      "react",
      "react-dom",
      "@codemirror/language",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/highlight",
    ],
  },
  server: {
    port: 5174,
    fs: {
      // Workspace dependencies are installed at the repository root.
      allow: [".."],
    },
    proxy: devProxy,
  },
});
