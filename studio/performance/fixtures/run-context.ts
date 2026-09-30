import path from "node:path";

import { RUN_FILES } from "../report/schema.mjs";

/**
 * What `scripts/performance/run.mjs` tells the Playwright suite about the run
 * it is part of. The orchestrator owns the runtime, the ports and the artifact
 * directory; the suite only reads them.
 */
export interface PerformanceRunContext {
  runIdentifier: string;
  runDirectory: string;
  engine: string;
  dataset: string;
  captures: string[];
  repetitionsOverride: number | null;
  baseURL: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is unset. Run the profiling suite through `
      + "`npm run perf:run --workspace @worktracker/studio`, which prepares the "
      + "isolated runtime, ports and artifact directory this suite expects.",
    );
  }
  return value;
}

export function performanceRunContext(): PerformanceRunContext {
  const repetitions = process.env.TICKETRY_PERF_REPETITIONS;
  return {
    runIdentifier: required("TICKETRY_PERF_RUN_ID"),
    runDirectory: required("TICKETRY_PERF_RUN_DIR"),
    engine: required("TICKETRY_PERF_ENGINE"),
    dataset: process.env.TICKETRY_PERF_DATASET ?? "small",
    captures: (process.env.TICKETRY_PERF_CAPTURES ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    repetitionsOverride: repetitions ? Number(repetitions) : null,
    baseURL: required("TICKETRY_PERF_BASE_URL"),
  };
}

export function fixturePath(context: PerformanceRunContext): string {
  return path.join(context.runDirectory, RUN_FILES.fixture);
}

export function scenarioArtifactDirectory(
  context: PerformanceRunContext,
  scenario: string,
): string {
  return path.join(context.runDirectory, "scenarios", context.engine, scenario);
}
