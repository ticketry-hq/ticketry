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
    // Transform the initial module graph while Tauri compiles Rust, before
    // the new webview requests it. Keep optional feature chunks on demand.
    warmup: {
      clientFiles: ["./index.html"],
    },
    fs: {
      // Workspace dependencies are installed at the repository root.
      allow: [".."],
    },
    proxy: devProxy,
    watch: {
      // Playwright writes traces/reports into studio/ while the dev server
      // serves the app; watching those paths triggers full page reloads that
      // race the integration suite's interactions. The profiling build writes
      // its own optimized bundle into studio/dist-performance for the same
      // reason: a profiling run must not reload somebody else's dev server.
      ignored: [
        "**/playwright-report/**",
        "**/test-results/**",
        "**/dist-performance/**",
      ],
    },
  },
});
