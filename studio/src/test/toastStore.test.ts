import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useToastStore } from "../app/stores/toastStore";

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toastStore", () => {
  it("push appends a toast and returns its id; dismiss removes it", () => {
    const id = useToastStore.getState().push("error", "boom");
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ id, kind: "error", message: "boom" });

    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("assigns distinct ids and stacks in push order", () => {
    const a = useToastStore.getState().push("success", "one");
    const b = useToastStore.getState().push("error", "two");
    expect(a).not.toBe(b);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["one", "two"]);
  });

  it("auto-dismisses success after ~4s and errors after ~8s", () => {
    vi.useFakeTimers();
    toast.success("saved");
    toast.error("failed");
    expect(useToastStore.getState().toasts).toHaveLength(2);

    // Success clears first; the error lingers longer but does not persist.
    vi.advanceTimersByTime(4000);
    const afterSuccess = useToastStore.getState().toasts;
    expect(afterSuccess).toHaveLength(1);
    expect(afterSuccess[0]).toMatchObject({ kind: "error", message: "failed" });

    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("toast.success / toast.error helpers push the matching kind via getState()", () => {
    toast.success("ok");
    toast.error("nope");
    expect(useToastStore.getState().toasts.map((t) => t.kind)).toEqual(["success", "error"]);
  });
});
