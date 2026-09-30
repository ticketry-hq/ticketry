import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { summarizeCpuProfile, summarizeRetention } from "../../performance/report/summarize.mjs";
import { studioRoot } from "./paths.mjs";

/**
 * Prove the collectors detect causes that are already known.
 *
 * Before any number from these collectors is used to say something about
 * Ticketry, they have to find a busy loop that is deliberately busy and growth
 * that is deliberately retained. These are collector checks, not application
 * benchmarks, and they say nothing about Ticketry's own performance.
 */
const checksDirectory = path.join(studioRoot, "performance", "checks");

function serveChecks() {
  const server = createServer((request, response) => {
    const name = path.basename(new URL(request.url, "http://127.0.0.1").pathname);
    try {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(readFileSync(path.join(checksDirectory, name)));
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server,
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

async function checkCpuCollector(browser, origin) {
  const page = await browser.newPage();
  const session = await page.context().newCDPSession(page);
  try {
    await page.goto(`${origin}/busy-loop.html`);
    await page.waitForFunction(() => window.__checkReady === true);
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 100 });
    await session.send("Profiler.start");
    await page.waitForTimeout(3_000);
    const { profile } = await session.send("Profiler.stop");
    const summary = summarizeCpuProfile(profile);
    const found = summary.frames?.find((frame) =>
      frame.functionName === "ticketryProfilingBusyLoop"
    );
    return {
      check: "chromium CPU sampling names a deliberately busy function",
      passed: Boolean(found),
      sampleCount: summary.sampleCount ?? null,
      topFrames: summary.frames?.slice(0, 5).map((frame) => ({
        functionName: frame.functionName,
        selfPercent: frame.selfPercent,
      })) ?? [],
      detail: found
        ? `ticketryProfilingBusyLoop took ${found.selfPercent?.toFixed(1)}% of sampled self time`
        : "the busy function did not appear in the sampled self-time ranking",
    };
  } finally {
    await session.detach().catch(() => {});
    await page.close();
  }
}

async function checkMemoryCollector(browser, origin) {
  const page = await browser.newPage();
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("HeapProfiler.enable");
    await page.goto(`${origin}/retained-allocation.html`);
    await page.waitForFunction(() => window.__checkReady === true);
    const batches = [];
    for (let batch = 0; batch < 4; batch += 1) {
      await page.evaluate(() => {
        for (let index = 0; index < 5; index += 1) window.__checkCycle();
      });
      await session.send("HeapProfiler.collectGarbage");
      await page.waitForTimeout(200);
      const usage = await session.send("Runtime.getHeapUsage");
      const counters = await session.send("Memory.getDOMCounters");
      batches.push({
        usedJsHeapBytes: usage.usedSize,
        domNodeCount: counters.nodes,
      });
    }
    const summary = summarizeRetention(batches);
    const passed = summary.heapGrowthBytesAfterWarmup > 1024 * 1024
      && summary.domGrowthAfterWarmup > 0;
    return {
      check: "chromium heap and DOM sampling detects deliberately retained growth",
      passed,
      heapGrowthBytesAfterWarmup: summary.heapGrowthBytesAfterWarmup,
      domGrowthAfterWarmup: summary.domGrowthAfterWarmup,
      detail: passed
        ? "growth was detected across settled batches after the warmup batch"
        : "the collector did not report the growth this page deliberately retains",
    };
  } finally {
    await session.detach().catch(() => {});
    await page.close();
  }
}

export async function main() {
  const site = await serveChecks();
  const browser = await chromium.launch({ headless: true });
  try {
    const results = [
      await checkCpuCollector(browser, site.origin),
      await checkMemoryCollector(browser, site.origin),
    ];
    for (const result of results) {
      console.log(
        `${result.passed ? "ok  " : "FAIL"} ${result.check}\n     ${result.detail}`,
      );
    }
    if (results.some((result) => !result.passed)) {
      throw new Error(
        "a collector failed to detect a known cause; do not interpret Ticketry "
        + "measurements from these collectors until this passes",
      );
    }
  } finally {
    await browser.close();
    await site.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[performance] collector verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
