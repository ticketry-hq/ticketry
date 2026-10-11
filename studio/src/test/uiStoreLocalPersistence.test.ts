import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClientStore } from "../state/clientStore";

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
    useClientStore.getState().setPanelLayout([40, 60]);
    vi.advanceTimersByTime(200);
    useClientStore.getState().setPanelLayout([35, 65]);

    vi.advanceTimersByTime(399);
    expect(localStorage.getItem("studio.panelLayout:v1")).toBeNull();

    vi.advanceTimersByTime(1);
    expect(localStorage.getItem("studio.panelLayout:v1")).toBe(
      JSON.stringify([35, 65]),
    );
  });
});
