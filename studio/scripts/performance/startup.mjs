import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer, loadConfigFromFile } from "vite";
import { webkit } from "playwright";

// Isolate Vite's contribution: fresh transform cache and browser context per
// sample, existing dependency prebundle retained, no product database access.
// Playwright WebKit is a proxy for WKWebView, not a desktop paint measurement.
const root = fileURLToPath(new URL("../..", import.meta.url));
// Match npm's Studio workspace cwd (Tailwind resolves its config from cwd).
process.chdir(root);
const output = fileURLToPath(new URL("../../../.ticketry-dev/performance/startup.json", import.meta.url));
const leadMs = 5_000;
const samples = [];
const browser = await webkit.launch();
try {
  for (const warmup of [false, true, true, false, false, true]) {
    const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, `${root}/vite.config.ts`);
    const config = loaded.config;
    config.server = {
      ...config.server,
      host: "127.0.0.1",
      port: 0,
      open: false,
      warmup: warmup ? config.server.warmup : { clientFiles: [] },
    };
    const server = await createServer({ ...config, root, configFile: false, logLevel: "error" });
    const context = await browser.newContext();
    try {
      const started = performance.now();
      await server.listen();
      const serverListenMs = performance.now() - started;
      // Simulate work the launcher can overlap with frontend transformation.
      await new Promise((resolve) => setTimeout(resolve, leadMs));
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error(`[startup probe] ${error.message}`));
      await page.route(/\/graphql(?:\/subscribe)?(?:\?.*)?$/, (route) => route.fulfill({
        status: 503, contentType: "application/json", body: '{"errors":[{"message":"Startup probe: backend deliberately excluded"}]}',
      }));
      await page.addInitScript(() => {
        performance.setResourceTimingBufferSize(10_000);
        window.__startupProbe = { stages: [], firstContentFrameMs: null };
        const original = console.info;
        console.info = (...args) => {
          if (args[0] === "[startup-trace]") {
            window.__startupProbe.stages.push({ ...JSON.parse(args[1]), navigationMs: performance.now() });
          }
          original.apply(console, args);
        };
        const observer = new MutationObserver(() => {
          if (!document.getElementById("root")?.textContent?.trim()) return;
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            window.__startupProbe.firstContentFrameMs = performance.now();
          }));
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      await page.goto(server.resolvedUrls.local[0], { waitUntil: "load" });
      await page.waitForFunction(() => window.__startupProbe.firstContentFrameMs !== null).catch(async (error) => {
        console.error(await page.evaluate(() => ({ probe: window.__startupProbe, body: document.body.innerText.slice(0, 1000) })));
        throw error;
      });
      const observation = await page.evaluate(() => ({
        ...window.__startupProbe,
        navigation: performance.getEntriesByType("navigation")[0].toJSON(),
        resources: performance.getEntriesByType("resource").map((entry) => entry.toJSON()),
      }));
      const scheduled = observation.stages.find((stage) => stage.stage === "frontend-render-scheduled");
      const sample = {
        warmup, serverListenMs, leadMs,
        renderScheduledMs: scheduled?.navigationMs ?? null,
        ...observation,
      };
      samples.push(sample);
      console.log(JSON.stringify({
        warmup, renderScheduledMs: sample.renderScheduledMs,
        firstContentFrameMs: sample.firstContentFrameMs,
        resources: sample.resources.length,
      }));
    } finally {
      await context.close();
      await server.close();
    }
  }
} finally {
  await browser.close();
  mkdirSync(new URL("../../../.ticketry-dev/performance/", import.meta.url), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    scope: "Vite dev navigation in Playwright WebKit; no backend, no native window, first content is the startup gate, double-rAF is a frame opportunity rather than proof of physical paint",
    dependencyCache: "existing prebundle retained; fresh Vite server and browser context per sample",
    samples,
  }, null, 2)}\n`);
  console.log(`Startup measurements: ${output}`);
}
