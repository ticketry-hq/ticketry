import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CDPSession, Page } from "@playwright/test";

import { ARTIFACTS } from "../report/schema.mjs";
import { summarizeCpuProfile } from "../report/summarize.mjs";

/**
 * Chromium CPU sampling over one defined workload.
 *
 * This is a diagnostic mode, never part of a low-overhead timing run: the
 * sampler itself perturbs the thing being timed. Recording starts immediately
 * before the workload and stops in a finally block, and the CDP session is
 * detached even when the workload throws, so a failed scenario never leaks a
 * profiler into the next one.
 */
export interface CpuCaptureResult {
  profilePath: string;
  summaryPath: string;
  summary: ReturnType<typeof summarizeCpuProfile>;
}

export async function recordCpuProfile<T>(
  page: Page,
  {
    directory,
    samplingIntervalUs = 100,
  }: { directory: string; samplingIntervalUs?: number },
  workload: () => Promise<T>,
): Promise<{ result: T; capture: CpuCaptureResult }> {
  const session = await page.context().newCDPSession(page);
  let profile: unknown = null;
  let result: T;
  try {
    await session.send("Profiler.enable");
    // Set the interval before recording; changing it mid-recording is ignored.
    await session.send("Profiler.setSamplingInterval", { interval: samplingIntervalUs });
    await session.send("Profiler.start");
    try {
      result = await workload();
    } finally {
      ({ profile } = await session.send("Profiler.stop"));
    }
  } finally {
    await session.detach().catch(() => {
      // The page may already be closed; the profile is what matters here.
    });
  }
  const profilePath = path.join(directory, ARTIFACTS.cpuProfile);
  await writeFile(profilePath, JSON.stringify(profile));
  const summary = summarizeCpuProfile(profile);
  const summaryPath = path.join(directory, ARTIFACTS.cpuSummary);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return { result: result!, capture: { profilePath, summaryPath, summary } };
}

/**
 * Cumulative renderer task and script duration, as deltas across the workload.
 *
 * These are renderer-process metrics. They are not a machine CPU percentage
 * and reports must not present them as one.
 */
export async function recordRendererMetrics<T>(
  page: Page,
  workload: () => Promise<T>,
): Promise<{ result: T; metrics: Record<string, number> | null; reason: string | null }> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Performance.enable");
    const before = await readMetrics(session);
    const result = await workload();
    const after = await readMetrics(session);
    const metrics: Record<string, number> = {};
    for (const [name, value] of Object.entries(after)) {
      if (name in before) metrics[name] = value - before[name];
    }
    return { result, metrics, reason: null };
  } finally {
    await session.detach().catch(() => {
      // Detaching is best effort; a closed page has already released it.
    });
  }
}

async function readMetrics(session: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await session.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((entry) => [entry.name, entry.value]));
}
