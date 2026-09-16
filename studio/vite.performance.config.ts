import { defineConfig, mergeConfig } from "vite";

import baseConfig from "./vite.config";
import { developmentProxy } from "./vite.proxy";

/**
 * Optimized, source-mapped frontend build used only by the performance
 * profiling suite (`studio/performance`).
 *
 * It writes `dist-performance` instead of `dist`, so a profiling run never
 * overwrites the bundle an ordinary `npm run build` or release workflow owns,
 * and the recorded source maps always match the recorded bundle.
 *
 * `vite preview` serves that directory through the same development proxy
 * table the dev server uses, so GraphQL, the SSE subscription route, documents
 * and the terminal WebSocket upgrade all reach the isolated Rust adapter named
 * by `MUXED_VITE_GRAPHQL_ORIGIN`.
 */
export default defineConfig(
  mergeConfig(baseConfig, {
    build: {
      outDir: "dist-performance",
      emptyOutDir: true,
      sourcemap: true,
      // Keep the recorded profile readable: minified names still resolve
      // through the emitted source maps, and chunk names stay stable.
      minify: "esbuild",
    },
    preview: {
      host: "127.0.0.1",
      strictPort: true,
      open: false,
      proxy: developmentProxy(),
    },
  }),
);
