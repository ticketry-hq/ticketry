import { readFile } from "node:fs/promises";
import { expect, test as base, type Page } from "@playwright/test";

import {
  installPerformanceProbes,
  PERFORMANCE_PROBE_GLOBAL,
} from "../collectors/browser-probes";
import { createRequestCounter, type RequestCounter } from "../collectors/request-counts";
import { ScenarioRecorder } from "../report/observations";
import {
  fixturePath,
  performanceRunContext,
  scenarioArtifactDirectory,
  type PerformanceRunContext,
} from "./run-context";
import type { SeedResult } from "./seed";

/**
 * The fixtures every profiling scenario shares.
 *
 * Probes are installed before navigation, the request counter attaches from
 * the runner side rather than from inside the application, and the recorder is
 * written in a teardown that runs whether the scenario passed or failed.
 */
export interface PerformanceFixtures {
  scenarioName: string;
  run: PerformanceRunContext;
  seed: SeedResult;
  probes: void;
  operations: RequestCounter;
  recorder: ScenarioRecorder;
}

export const performanceTest = base.extend<PerformanceFixtures>({
  // Each scenario file names itself with `test.use({ scenarioName })` so its
  // artifacts land in a directory a manifest can point at.
  scenarioName: ["unnamed", { option: true }],
  run: async ({}, use) => {
    await use(performanceRunContext());
  },
  seed: async ({ run }, use) => {
    await use(JSON.parse(await readFile(fixturePath(run), "utf8")) as SeedResult);
  },
  probes: async ({ page }, use) => {
    await page.addInitScript(installPerformanceProbes);
    await use();
  },
  operations: async ({ page }, use) => {
    const counter = createRequestCounter(page);
    try {
      await use(counter);
    } finally {
      counter.dispose();
    }
  },
  recorder: async ({ run, scenarioName, browser, browserName }, use) => {
    const recorder = new ScenarioRecorder({
      scenario: scenarioName,
      engine: run.engine,
      directory: scenarioArtifactDirectory(run, scenarioName),
    });
    try {
      await use(recorder);
    } finally {
      await recorder.write({
        recordedAt: new Date().toISOString(),
        engineName: browserName,
        engineVersion: browser.version(),
      });
    }
  },
});

export { expect };

export function startProbes(page: Page, label: string): Promise<string> {
  return page.evaluate(
    ([globalName, probeLabel]) =>
      (window as unknown as Record<string, { start(label: string): string }>)[globalName]
        .start(probeLabel),
    [PERFORMANCE_PROBE_GLOBAL, label] as const,
  );
}

export function stopProbes(page: Page): Promise<unknown> {
  return page.evaluate(
    (globalName) =>
      (window as unknown as Record<string, { stop(): unknown }>)[globalName].stop(),
    PERFORMANCE_PROBE_GLOBAL,
  );
}

export function probeSnapshot(page: Page): Promise<unknown> {
  return page.evaluate(
    (globalName) =>
      (window as unknown as Record<string, { snapshot(): unknown }>)[globalName].snapshot(),
    PERFORMANCE_PROBE_GLOBAL,
  );
}

export function probeTotals(page: Page): Promise<unknown> {
  return page.evaluate(
    (globalName) =>
      (window as unknown as Record<string, { totals(): unknown }>)[globalName].totals(),
    PERFORMANCE_PROBE_GLOBAL,
  );
}

export function probeCapabilities(page: Page): Promise<unknown> {
  return page.evaluate(
    (globalName) =>
      (window as unknown as Record<string, { capabilities: unknown }>)[globalName]
        .capabilities,
    PERFORMANCE_PROBE_GLOBAL,
  );
}

/** Counted at batch boundaries only, never inside a timed interaction. */
export function domNodeCount(page: Page): Promise<number> {
  return page.evaluate(
    (globalName) =>
      (window as unknown as Record<string, { domNodeCount(): number }>)[globalName]
        .domNodeCount(),
    PERFORMANCE_PROBE_GLOBAL,
  );
}

/** The terminal renderer's own counters, or an explicit reason they are absent. */
export function rendererMeasurements(page: Page): Promise<unknown> {
  return page.evaluate(
    (globalName) =>
      (window as unknown as Record<string, { rendererMeasurements(): unknown }>)[globalName]
        .rendererMeasurements(),
    PERFORMANCE_PROBE_GLOBAL,
  );
}

/**
 * How long any single asserted step inside a measured repetition may wait.
 *
 * Short on purpose. If a step is going to fail, the run needs it recorded as a
 * failed repetition inside a bounded window, not swallowed by the whole
 * scenario's timeout with nothing to show for it.
 */
export const STEP_TIMEOUT_MS = 8_000;

/**
 * Run one measured repetition, recording it whether it succeeds or not.
 *
 * A scenario that reported only its successful repetitions would describe the
 * subset of the application that happened to work, so a failed repetition is
 * timed, recorded and counted, and the loop carries on. `recover` puts the UI
 * back into a known state before the next repetition.
 */
export async function measuredRepetition(
  recorder: ScenarioRecorder,
  name: string,
  action: () => Promise<unknown>,
  recover?: () => Promise<void>,
): Promise<boolean> {
  try {
    await recorder.time(name, action);
    return true;
  } catch (error) {
    void error;
    await recover?.().catch(() => {
      // Recovery is best effort; the failure is already recorded.
    });
    return false;
  }
}

/**
 * The errors a probe snapshot counted inside its own window.
 *
 * Scoped deliberately: an error raised while the fixture was being opened
 * describes the setup, not the measurement, and is recorded through
 * `probeTotals` instead of failing a timing run.
 */
export function windowErrors(
  snapshot: unknown,
): { pageErrors: number; consoleErrors: number; messages: string[] } {
  const errors = (snapshot as { errors?: unknown } | null)?.errors;
  return (errors as { pageErrors: number; consoleErrors: number; messages: string[] })
    ?? { pageErrors: 0, consoleErrors: 0, messages: [] };
}

/**
 * A bounded settling period.
 *
 * `networkidle` is never used as readiness here: the application holds a
 * persistent subscription, so its network is never idle and waiting for it
 * would either hang or lie. Scenarios assert the DOM state they expect and
 * then settle for a fixed interval.
 */
export function settle(page: Page, milliseconds: number): Promise<void> {
  return page.waitForTimeout(milliseconds);
}

/** Open a seeded module tab and wait for its workspace to be asserted ready. */
export async function openSeededModule(page: Page, moduleName: string): Promise<void> {
  const tab = page.getByRole("tab", { name: moduleName }).last();
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}

/** Load the app and settle once, before any measured window opens. */
export async function openWorkspace(page: Page, settleMs = 2_000): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("module-workspace-region").or(
    page.getByTestId("empty-module-workspace"),
  )).toBeVisible();
  await settle(page, settleMs);
}
