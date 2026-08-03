import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../features/studio/stores/uiStore";

describe("UI store local persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("debounces panel layout writes and persists the latest layout", () => {
    useUIStore.getState().setPanelLayout([10, 20, 40, 30]);
    vi.advanceTimersByTime(200);
    useUIStore.getState().setPanelLayout([15, 20, 35, 30]);

    vi.advanceTimersByTime(399);
    expect(localStorage.getItem("studio.panelLayout:v1")).toBeNull();

    vi.advanceTimersByTime(1);
    expect(localStorage.getItem("studio.panelLayout:v1")).toBe(
      JSON.stringify([15, 20, 35, 30]),
    );
  });
});
