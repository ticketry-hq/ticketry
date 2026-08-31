import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRuntime } from "../../runtime/browserRuntime";
import { AppUpdateCheckError, AppUpdateOperationError } from "../../runtime";
import { createDesktopRuntime } from "../../runtime/desktopRuntime";

function startupConfiguration() {
  return {
    serviceHealth: {
      state: "ready",
      service: "backend",
      message: null,
      logPointer: null,
    },
    initialNotices: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("app updates runtime contract", () => {
  it("advertises desktop update checks", async () => {
    const runtime = await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startupConfiguration()),
    });

    expect(runtime.capabilities.appUpdates).toBe(true);
  });

  it("checks the stable channel update feed through one desktop operation", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockResolvedValueOnce({
        installed_version: "0.2.0",
        status: "available",
        available_version: "0.3.0",
        notes: "Faster project switching.",
      });
    const runtime = await createDesktopRuntime({ invoke });

    await expect(runtime.appUpdates.check()).resolves.toEqual({
      installedVersion: "0.2.0",
      status: "available",
      availableVersion: "0.3.0",
      notes: "Faster project switching.",
    });
    expect(invoke).toHaveBeenLastCalledWith("desktop_update_check");
  });

  it("reports the installed version when the update check is current", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockResolvedValueOnce({
        installed_version: "0.2.0",
        status: "current",
      });
    const runtime = await createDesktopRuntime({ invoke });

    await expect(runtime.appUpdates.check()).resolves.toEqual({
      installedVersion: "0.2.0",
      status: "current",
    });
  });

  it("preserves an available update when the update feed omits notes", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockResolvedValueOnce({
        installed_version: "0.2.0",
        status: "available",
        available_version: "0.3.0",
      });
    const runtime = await createDesktopRuntime({ invoke });

    await expect(runtime.appUpdates.check()).resolves.toEqual({
      installedVersion: "0.2.0",
      status: "available",
      availableVersion: "0.3.0",
    });
  });

  it("returns an actionable retryable error when the update feed is unreachable", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockRejectedValueOnce({
        code: "update_feed_unreachable",
        message: "The stable channel update feed could not be reached. Check your connection and retry the update check.",
        retryable: true,
      });
    const runtime = await createDesktopRuntime({ invoke });

    const error = await runtime.appUpdates.check().catch((caught) => caught);

    expect(error).toBeInstanceOf(AppUpdateCheckError);
    expect(error).toMatchObject({
      code: "update_feed_unreachable",
      message: "The stable channel update feed could not be reached. Check your connection and retry the update check.",
      retryable: true,
    });
  });

  it("downloads and installs the checked update through one desktop operation", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockResolvedValueOnce(undefined);
    const runtime = await createDesktopRuntime({ invoke });

    await expect(runtime.appUpdates.downloadAndInstall()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenLastCalledWith(
      "desktop_update_download_and_install",
    );
  });

  it("rejects an invalid update signature as non-retryable without changing the error", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockRejectedValueOnce({
        code: "update_signature_invalid",
        message: "Update rejected: invalid signature.",
        retryable: false,
      });
    const runtime = await createDesktopRuntime({ invoke });

    const error = await runtime.appUpdates.downloadAndInstall().catch(
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(AppUpdateOperationError);
    expect(error).toMatchObject({
      code: "update_signature_invalid",
      message: "Update rejected: invalid signature.",
      retryable: false,
    });
  });

  it("reports an interrupted update download as retryable", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockRejectedValueOnce({
        code: "update_download_failed",
        message: "The update download was interrupted. Retry the download.",
        retryable: true,
      });
    const runtime = await createDesktopRuntime({ invoke });

    const error = await runtime.appUpdates.downloadAndInstall().catch(
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(AppUpdateOperationError);
    expect(error).toMatchObject({
      code: "update_download_failed",
      message: "The update download was interrupted. Retry the download.",
      retryable: true,
    });
  });

  it("normalizes an unexpected download or install failure for retry", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockRejectedValueOnce(new Error("native updater internals"));
    const runtime = await createDesktopRuntime({ invoke });

    const error = await runtime.appUpdates.downloadAndInstall().catch(
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(AppUpdateOperationError);
    expect(error).toMatchObject({
      code: "update_operation_failed",
      message: "The update could not be downloaded or installed. Retry the update.",
      retryable: true,
    });
  });

  it("subscribes to cumulative desktop update progress and tears it down", async () => {
    let progressHandler: ((event: { payload: unknown }) => void) | undefined;
    const stop = vi.fn();
    const listen = vi.fn().mockImplementation(async (event, handler) => {
      if (event === "desktop-update-progress") progressHandler = handler;
      return stop;
    });
    const runtime = await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startupConfiguration()),
      listen,
    });
    const listener = vi.fn();

    const unsubscribe = runtime.appUpdates.subscribeProgress(listener);
    await vi.waitFor(() => expect(progressHandler).toBeDefined());
    progressHandler?.({
      payload: { received_bytes: 32_768, total_bytes: 131_072 },
    });
    progressHandler?.({
      payload: { received_bytes: 65_536, total_bytes: null },
    });
    progressHandler?.({
      payload: { received_bytes: -1, total_bytes: 131_072 },
    });

    expect(listener.mock.calls).toEqual([
      [{ receivedBytes: 32_768, totalBytes: 131_072 }],
      [{ receivedBytes: 65_536 }],
    ]);

    unsubscribe();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });

  it("requests the update restart through its dedicated desktop operation", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(startupConfiguration())
      .mockResolvedValueOnce(undefined);
    const runtime = await createDesktopRuntime({ invoke });

    await expect(runtime.appUpdates.restart()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenLastCalledWith("desktop_update_restart");
  });

  it("keeps browser update checks unavailable without calling Tauri", async () => {
    const tauriInvoke = vi.fn();
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: tauriInvoke });
    const runtime = createBrowserRuntime({ environment: {} });

    expect(runtime.capabilities.appUpdates).toBe(false);
    await expect(runtime.appUpdates.check()).rejects.toThrowError(
      "App updates are managed by the desktop app.",
    );
    expect(tauriInvoke).not.toHaveBeenCalled();
  });

  it("rejects browser download, install, and restart operations without calling Tauri", async () => {
    const tauriInvoke = vi.fn();
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: tauriInvoke });
    const runtime = createBrowserRuntime({ environment: {} });

    await expect(runtime.appUpdates.downloadAndInstall()).rejects.toThrowError(
      "App updates are managed by the desktop app.",
    );
    await expect(runtime.appUpdates.restart()).rejects.toThrowError(
      "App updates are managed by the desktop app.",
    );
    expect(runtime.appUpdates.subscribeProgress(vi.fn())).toEqual(
      expect.any(Function),
    );
    expect(tauriInvoke).not.toHaveBeenCalled();
  });
});
