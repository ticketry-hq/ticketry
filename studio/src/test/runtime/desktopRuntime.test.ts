import { describe, expect, it, vi } from "vitest";
import { createDesktopRuntime } from "../../runtime/desktopRuntime";

function startupConfiguration() {
  return {
    endpoints: {
      workTrackerApi: "http://127.0.0.1:8787/api/work-tracker",
      agentApi: "http://127.0.0.1:8787/api",
      statusApi: "http://127.0.0.1:8787/api",
      statusWebSocket: "ws://127.0.0.1:8787/ws/status",
      terminalWebSocket: "ws://127.0.0.1:8787/ws/terminal",
    },
    values: { workTrackerApiKey: "" },
    serviceHealth: {
      state: "ready",
      service: "backend",
      message: null,
      logPointer: null,
    },
  };
}

describe("desktop runtime contract", () => {
  it("loads startup configuration through one narrow native operation", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ...startupConfiguration(),
      values: { workTrackerApiKey: "ephemeral-key" },
    });

    const runtime = await createDesktopRuntime({ invoke });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("desktop_runtime_configuration");
    expect(runtime.platform).toBe("desktop");
    expect(runtime.startup()).toEqual({
      endpoints: {
        workTrackerApi: "http://127.0.0.1:8787/api/work-tracker",
        agentApi: "http://127.0.0.1:8787/api",
        statusApi: "http://127.0.0.1:8787/api",
        statusWebSocket: "ws://127.0.0.1:8787/ws/status",
        terminalWebSocket: "ws://127.0.0.1:8787/ws/terminal",
      },
      values: { workTrackerApiKey: "ephemeral-key" },
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
    });
  });

  it("reports only capabilities implemented by this desktop slice", async () => {
    const invoke = vi.fn().mockResolvedValue(startupConfiguration());

    const runtime = await createDesktopRuntime({ invoke });

    expect(runtime.capabilities).toEqual({
      statusFeed: true,
      websocketTerminal: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
    });
  });

  it("returns one validated absolute folder path from the native picker", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockResolvedValueOnce("/repos/picked");
    const runtime = await createDesktopRuntime({ invoke });

    await expect(runtime.pickFolder()).resolves.toBe("/repos/picked");
    expect(invoke).toHaveBeenLastCalledWith("desktop_pick_folder");
  });

  it("retries the supervised pair through one zero-argument native operation", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockResolvedValueOnce(undefined);
    const runtime = await createDesktopRuntime({ invoke });

    await runtime.retryServices();

    expect(invoke).toHaveBeenLastCalledWith("desktop_retry_services");
  });

  it("preserves native picker cancellation and rejects non-absolute results", async () => {
    const cancelledInvoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockResolvedValueOnce(null);
    const cancelledRuntime = await createDesktopRuntime({
      invoke: cancelledInvoke,
    });

    await expect(cancelledRuntime.pickFolder()).resolves.toBeNull();

    const invalidInvoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockResolvedValueOnce("relative/repo");
    const invalidRuntime = await createDesktopRuntime({ invoke: invalidInvoke });

    await expect(invalidRuntime.pickFolder()).rejects.toThrowError(
      "Desktop initialization failed: picked folder must be an absolute path or null",
    );
  });

  it("rejects invalid native startup configuration with an actionable error", async () => {
    const configuration = startupConfiguration();
    const invoke = vi.fn().mockResolvedValue({
      ...configuration,
      endpoints: {
        ...configuration.endpoints,
        statusWebSocket: "ftp://127.0.0.1/ws/status",
      },
    });

    await expect(createDesktopRuntime({ invoke })).rejects.toThrowError(
      "Desktop initialization failed: statusWebSocket must be a loopback WebSocket URL",
    );
  });

  it("rejects endpoints that the desktop content policy cannot reach", async () => {
    const configuration = startupConfiguration();
    const invoke = vi.fn().mockResolvedValue({
      ...configuration,
      endpoints: {
        ...configuration.endpoints,
        agentApi: "https://runtime.example.test/api",
      },
    });

    await expect(createDesktopRuntime({ invoke })).rejects.toThrowError(
      "Desktop initialization failed: agentApi must be a loopback HTTP(S) URL",
    );
  });
});
