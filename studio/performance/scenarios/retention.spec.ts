import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { CDPSession, Page } from "@playwright/test";

import {
  captureHeapSnapshot,
  collectGarbage,
  openMemorySession,
  sampleMemory,
} from "../collectors/chromium-memory";
import { ARTIFACTS } from "../report/schema.mjs";
import { summarizeRetention } from "../report/summarize.mjs";
import {
  domNodeCount,
  expect,
  openSeededModule,
  openWorkspace,
  performanceTest as test,
  probeCapabilities,
  probeTotals,
  settle,
  startProbes,
  stopProbes,
  windowErrors,
} from "../fixtures/scenario";
import { scenarioArtifactDirectory } from "../fixtures/run-context";

/**
 * Retention.
 *
 * A fixed working set is cycled in batches: the same two modules, the same
 * items, the same picker. Because the working set never grows, anything that
 * does is a lead worth chasing. It is only a lead — cache warmup also grows a
 * heap, which is why the first batch is labelled warmup and why growth is only
 * interesting when it continues batch after settled batch.
 *
 * Garbage collection is forced here and nowhere else, and only between
 * batches: forcing it inside a timing run would measure the collector.
 */
const BATCHES = 5;
const CYCLES_PER_BATCH = 20;
const SETTLE_MS = 3_000;

test.use({ scenarioName: "retention" });

async function cycle(page: Page, seed: { navigationModules: { name: string }[] }) {
  const [first, second] = seed.navigationModules;
  await openSeededModule(page, first!.name);
  const trigger = page.getByRole("button", { name: "Open module picker" });
  await trigger.click();
  const picker = page.getByRole("dialog", { name: "Module picker" });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await openSeededModule(page, second!.name);
}

test("cycles a fixed working set in five settled batches", async ({
  page,
  seed,
  run,
  operations,
  recorder,
  probes: _probes,
}) => {
  test.setTimeout(900_000);
  const batches = run.repetitionsOverride ?? BATCHES;
  const directory = scenarioArtifactDirectory(run, "retention");
  await mkdir(directory, { recursive: true });
  recorder.describe({
    batches,
    cyclesPerBatch: CYCLES_PER_BATCH,
    settleMs: SETTLE_MS,
    modules: seed.navigationModules.map((module) => module.name),
    datasetVersion: seed.datasetVersion,
    datasetSize: seed.size,
    forcedGarbageCollection: run.engine === "chromium",
  });

  let session: CDPSession | null = null;
  if (run.engine === "chromium") {
    session = await openMemorySession(page);
  } else {
    recorder.addCapture("memory", {
      value: null,
      reason: "CDP heap and DOM counters are Chromium-only; this engine records "
        + "only the in-page probe values",
    });
  }

  try {
    operations.startWindow("setup");
    await openWorkspace(page, SETTLE_MS);
    await cycle(page, seed);
    await settle(page, SETTLE_MS);
    operations.endWindow();

    if (session && run.captures.includes("heap-snapshot")) {
      const before = await captureHeapSnapshot(
        session,
        path.join(directory, ARTIFACTS.heapSnapshotBefore),
      );
      recorder.addCapture("heapSnapshotBefore", before);
    }

    operations.startWindow("measured");
    await startProbes(page, "retention");
    for (let batch = 0; batch < batches; batch += 1) {
      await recorder.time("retentionBatch", async () => {
        for (let index = 0; index < CYCLES_PER_BATCH; index += 1) {
          await cycle(page, seed);
        }
      });
      await settle(page, SETTLE_MS);
      if (session) await collectGarbage(session);
      await settle(page, 500);
      const sample = session
        ? await sampleMemory(session, `batch-${batch + 1}`)
        : {
          at: new Date().toISOString(),
          label: `batch-${batch + 1}`,
          usedJsHeapBytes: null,
          totalJsHeapBytes: null,
          domNodeCount: null,
          documentCount: null,
          jsEventListenerCount: null,
          reason: "CDP memory sampling is Chromium-only",
        };
      recorder.addBatch({
        ...sample,
        // The probe's own DOM count is engine-independent, so a WebKit run
        // still produces a DOM series even without CDP counters.
        domNodeCount: sample.domNodeCount ?? await domNodeCount(page),
        warmup: batch === 0,
      });
    }
    const snapshot = await stopProbes(page);
    operations.endWindow();

    if (session && run.captures.includes("heap-snapshot")) {
      const after = await captureHeapSnapshot(
        session,
        path.join(directory, ARTIFACTS.heapSnapshotAfter),
      );
      recorder.addCapture("heapSnapshotAfter", after);
    }

    recorder.setProbes({
      ...(snapshot as Record<string, unknown>),
      capabilities: await probeCapabilities(page),
    });
    recorder.setOperations(operations.windows());
    recorder.describe({ subscriptionStreamsAborted: operations.streamsAborted() });
    recorder.setPageErrors(await probeTotals(page));
    for (const failure of operations.failures()) recorder.fail(failure);
    recorder.addCapture("retentionSummary", summarizeRetention(
      recorder.toJSON().batches ?? [],
    ));

    expect(
      windowErrors(snapshot).pageErrors,
      "page errors across the retention batches",
    ).toBe(0);
  } finally {
    await session?.detach().catch(() => {
      // The page may already be gone; the recorded batches are the deliverable.
    });
  }
});
