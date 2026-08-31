import { describe, expect, it, vi } from "vitest";
import { createDesktopRuntime } from "../../runtime/desktopRuntime";
import type { GraphQlTransportProxy } from "../../graphql-foundation/generated/taurpc";

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

function userNotice(id = "notice-1") {
  return {
    id,
    severity: "warning",
    title: "Runtime notice",
    message: "Something important happened.",
    acknowledgementLabel: "Understood",
  };
}

describe("desktop runtime contract", () => {
  it("loads startup configuration through one narrow native operation", async () => {
    const invoke = vi.fn().mockResolvedValue(startupConfiguration());

    const runtime = await createDesktopRuntime({ invoke });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("desktop_runtime_configuration");
    expect(runtime.platform).toBe("desktop");
    expect(runtime.startup()).toEqual({
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    });
  });

  it("reports only capabilities implemented by this desktop slice", async () => {
    const invoke = vi.fn().mockResolvedValue(startupConfiguration());

    const runtime = await createDesktopRuntime({ invoke });

    expect(runtime.capabilities).toEqual({
      statusFeed: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
      appUpdates: true,
    });
  });

  it("gives Apollo the configured in-process GraphQL transport", async () => {
    const invoke = vi.fn().mockResolvedValue(startupConfiguration());
    const proxy = {} as GraphQlTransportProxy;
    const createGraphQlProxy = vi.fn(() => proxy);
    const runtime = await createDesktopRuntime({ invoke, createGraphQlProxy });

    expect(runtime.graphQlTransport()).toBe(proxy);
    expect(createGraphQlProxy).toHaveBeenCalledOnce();
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

  it("retains valid initial notices and ignores malformed or duplicate entries", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ...startupConfiguration(),
      initialNotices: [
        userNotice("startup-1"),
        { ...userNotice("startup-1"), title: "Duplicate" },
        { ...userNotice("invalid-severity"), severity: "urgent" },
        { ...userNotice("invalid-id"), id: "contains spaces" },
        null,
      ],
    });

    const runtime = await createDesktopRuntime({ invoke });

    expect(runtime.startup().initialNotices).toEqual([userNotice("startup-1")]);
  });

  it("delivers later valid notices and drops malformed or previously seen ids", async () => {
    let noticeHandler: ((event: { payload: unknown }) => void) | undefined;
    const stop = vi.fn();
    const listen = vi.fn().mockImplementation(
      async (
        event: "desktop-service-health" | "desktop-user-notice",
        handler: (event: { payload: unknown }) => void,
      ) => {
        if (event === "desktop-user-notice") noticeHandler = handler;
        return stop;
      },
    );
    const invoke = vi.fn().mockResolvedValue({
      ...startupConfiguration(),
      initialNotices: [userNotice("startup-1")],
    });
    const runtime = await createDesktopRuntime({ invoke, listen });
    const listener = vi.fn();

    const unsubscribe = runtime.subscribeUserNotices(listener);
    await vi.waitFor(() => expect(noticeHandler).toBeDefined());
    noticeHandler?.({ payload: userNotice("later-1") });
    noticeHandler?.({ payload: userNotice("later-1") });
    noticeHandler?.({ payload: userNotice("startup-1") });
    noticeHandler?.({
      payload: { ...userNotice("malformed"), acknowledgementLabel: "" },
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(userNotice("later-1"));

    unsubscribe();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });
});
