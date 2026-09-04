import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useClientStore } from "../state/clientStore";

beforeEach(() => {
  useClientStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toastStore", () => {
  it("push appends a toast and returns its id; dismiss removes it", () => {
    const id = useClientStore.getState().pushToast("error", "boom");
    const toasts = useClientStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ id, kind: "error", message: "boom" });

    useClientStore.getState().dismissToast(id);
    expect(useClientStore.getState().toasts).toHaveLength(0);
  });

  it("assigns distinct ids and stacks in push order", () => {
    const a = useClientStore.getState().pushToast("success", "one");
    const b = useClientStore.getState().pushToast("error", "two");
    expect(a).not.toBe(b);
    expect(useClientStore.getState().toasts.map((t) => t.message)).toEqual(["one", "two"]);
  });

  it("auto-dismisses success and info after ~4s and errors after ~8s", () => {
    vi.useFakeTimers();
    toast.success("saved");
    toast.info("terminal closed");
    toast.error("failed");
    expect(useClientStore.getState().toasts).toHaveLength(3);

    // Non-errors clear first; the error lingers longer but does not persist.
    vi.advanceTimersByTime(4000);
    const afterSuccess = useClientStore.getState().toasts;
    expect(afterSuccess).toHaveLength(1);
    expect(afterSuccess[0]).toMatchObject({ kind: "error", message: "failed" });

    vi.advanceTimersByTime(4000);
    expect(useClientStore.getState().toasts).toHaveLength(0);
  });

  it("toast helpers push the matching kind via getState()", () => {
    toast.success("ok");
    toast.info("noted");
    toast.error("nope");
    expect(useClientStore.getState().toasts.map((t) => t.kind)).toEqual([
      "success",
      "info",
      "error",
    ]);
  });
});
