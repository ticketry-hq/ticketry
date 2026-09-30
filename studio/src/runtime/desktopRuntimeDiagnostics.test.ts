import { describe, expect, it, vi } from "vitest";

import {
  createDesktopRuntime,
  type DesktopInvoke,
} from "./desktopRuntime";

describe("desktop runtime diagnostics", () => {
  it("publishes the Rust runtime instance to the renderer", async () => {
    const configuration = {
      runtimeInstance: "runtime-1",
      serviceHealth: {
        state: "ready",
        service: null,
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    };
    const invoke: DesktopInvoke = async <T>() => configuration as T;

    const runtime = await createDesktopRuntime({ invoke });

    expect(runtime.startup().runtimeInstance).toBe("runtime-1");
  });

  it("reads the latest Crash Report collection outcome through one fixed command", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        serviceHealth: {
          state: "ready",
          service: null,
          message: null,
          logPointer: null,
        },
        initialNotices: [],
      })
      .mockResolvedValueOnce({ status: "report_collected" });
    const runtime = await createDesktopRuntime({ invoke });

    await expect(
      runtime.crashReports?.latestCollectionOutcome(),
    ).resolves.toEqual({ status: "report_collected" });
    expect(invoke).toHaveBeenLastCalledWith(
      "desktop_latest_crash_collection_outcome",
    );
  });

  it("reveals the fixed Crash Report folder through one command", async () => {
    const invoke = vi.fn().mockResolvedValue({
      serviceHealth: {
        state: "ready",
        service: null,
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    });
    const runtime = await createDesktopRuntime({ invoke });

    await runtime.crashReports?.revealFolder();

    expect(invoke).toHaveBeenLastCalledWith(
      "desktop_reveal_crash_report_folder",
    );
  });
});
