import { afterEach, describe, expect, it, vi } from "vitest";

import { beginModuleLoad, moduleLoadPoint, moduleLoadProbeActive } from "./moduleLoadProbe";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("module load timing", () => {
  it("keeps late responses on their original selection and ignores other modules", () => {
    vi.stubEnv("MODE", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    beginModuleLoad("module-a");
    const lateResponse = moduleLoadPoint("module-a");
    const firstId = JSON.parse(log.mock.calls[0]![1]).selection_id;
    beginModuleLoad("module-b");
    lateResponse("response-received");
    expect(JSON.parse(log.mock.calls.at(-1)![1])).toMatchObject({ selection_id: firstId, module_id: "module-a" });
    const count = log.mock.calls.length;
    moduleLoadPoint("module-a")("unrelated-render");
    expect(log).toHaveBeenCalledTimes(count);
    expect(moduleLoadProbeActive("module-a")).toBe(false);
  });

  it("preserves commit and paint after thousands of row builds and a long stall", () => {
    vi.stubEnv("MODE", "development");
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    beginModuleLoad("large");
    const probe = moduleLoadPoint("large");
    for (let index = 0; index < 5_000; index++) {
      probe("tree-materialized", { materialize_ms: 0.5 });
      probe("rows-derived", { derive_ms: 0.1 });
    }
    expect(log).toHaveBeenCalledTimes(1);
    now = 45_000;
    expect(moduleLoadProbeActive("large")).toBe(true);
    probe("tasks-committed", { task_count: 273, refreshing: false });
    now = 45_032;
    probe("tasks-paint-opportunity", { task_count: 273, refreshing: false });
    expect(log).toHaveBeenCalledTimes(3);
    expect(JSON.parse(log.mock.calls.at(-1)![1])).toMatchObject({
      stage: "tasks-paint-opportunity", elapsed_ms: 45_032,
      tree_builds: 5_000, tree_build_ms: 2_500,
      row_builds: 5_000, row_build_ms: 500, task_count: 273, refreshing: false,
    });
    now = 120_001;
    expect(moduleLoadProbeActive("large")).toBe(false);
    probe("tasks-committed");
    expect(log).toHaveBeenCalledTimes(3);
  });

  it("does not start probes in production", () => {
    vi.stubEnv("DEV", false);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    beginModuleLoad("production");
    moduleLoadPoint("production")("render");
    expect(log).not.toHaveBeenCalled();
  });
});
