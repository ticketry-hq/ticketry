import { describe, expect, it, vi } from "vitest";
import { createDesktopRuntime, type DesktopRuntimeListen } from "./desktopRuntime";

const health = { state: "starting", service: null, message: null, logPointer: null };
const configuration = { serviceHealth: health, initialNotices: [] };

describe("desktop runtime event lifetime", () => {
  it("rereads health after registration and ignores malformed events", async () => {
    let handler: ((event: { payload: unknown }) => void) | undefined;
    const ready = { ...health, state: "ready" };
    const invoke = vi.fn()
      .mockResolvedValueOnce(configuration)
      .mockResolvedValueOnce({ ...configuration, serviceHealth: ready });
    const stop = vi.fn();
    const listen: DesktopRuntimeListen = async (_event, next) => {
      handler = next;
      return stop;
    };
    const runtime = await createDesktopRuntime({ invoke, listen });
    const listener = vi.fn();
    const unsubscribe = runtime.subscribeServiceHealth(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(ready));
    handler?.({ payload: { ...ready, message: 42 } });
    handler?.({ payload: { ...ready, state: "unknown" } });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    handler?.({ payload: health });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
  });

  it.each(["health", "notices", "updates"] as const)(
    "disposes a late %s listener without delivering after cleanup",
    async (kind) => {
      let register: ((stop: () => void) => void) | undefined;
      let handler: ((event: { payload: unknown }) => void) | undefined;
      const listen: DesktopRuntimeListen = (_event, next) => {
        handler = next;
        return new Promise((resolve) => { register = resolve; });
      };
      const invoke = vi.fn().mockResolvedValue(configuration);
      const runtime = await createDesktopRuntime({ invoke, listen });
      const listener = vi.fn();
      const unsubscribe = kind === "health"
        ? runtime.subscribeServiceHealth(listener)
        : kind === "notices"
          ? runtime.subscribeUserNotices(listener)
          : runtime.appUpdates.subscribeProgress(listener);
      listener.mockClear();
      unsubscribe();
      const stop = vi.fn();
      register?.(stop);
      await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
      handler?.({ payload: kind === "health" ? health : kind === "updates"
        ? { received_bytes: 32, total_bytes: null }
        : { id: "notice-1", severity: "warning", title: "Notice", message: "Check logs.", acknowledgementLabel: "Understood" } });
      expect(listener).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledOnce();
    },
  );

  it("rejects malformed health during startup with the field diagnostic", async () => {
    await expect(createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue({
        ...configuration, serviceHealth: { ...health, message: 42 },
      }),
    })).rejects.toThrow("Desktop initialization failed: serviceHealth.message must be a string or null");
  });
});
