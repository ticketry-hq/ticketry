import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const studioRoot = fileURLToPath(new URL("../..", import.meta.url));

// Every feature stack serves the app from a Vite dev server rooted at studio/.
// Watching the shared Cargo target under src-tauri crawled ~300k files per
// stack, starving the proxy that carries GraphQL writes, and a build-script
// HTML write reloaded a live page mid-write (T2914).
test("feature stack dev server ignores Rust build output and still watches the app", { timeout: 300_000 }, async () => {
  const server = await createServer({
    configFile: path.join(studioRoot, "vite.config.ts"),
    root: studioRoot,
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { hmr: false },
  });
  const seen = new Set();
  server.watcher.on("all", (_event, file) => seen.add(path.resolve(file)));
  const targetRoot = path.join(studioRoot, "src-tauri", "target");
  await mkdir(targetRoot, { recursive: true });
  const buildDir = await mkdtemp(path.join(targetRoot, "devserver-watch-probe-"));
  const appDir = await mkdtemp(path.join(studioRoot, ".devserver-watch-probe-"));
  try {
    await new Promise((resolve) => server.watcher.once("ready", resolve));
    const buildFile = path.join(buildDir, "tauri-codegen-asset.html");
    const appFile = path.join(appDir, "page.html");
    await writeFile(buildFile, "<html></html>");
    await writeFile(appFile, "<html></html>");
    const deadline = Date.now() + 20_000;
    while (!seen.has(appFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.ok(seen.has(appFile), "the dev server stopped watching app files");
    assert.ok(!seen.has(buildFile), "the dev server watches Rust build output under src-tauri/target");
  } finally {
    await server.close();
    await rm(buildDir, { recursive: true, force: true });
    await rm(appDir, { recursive: true, force: true });
  }
});
