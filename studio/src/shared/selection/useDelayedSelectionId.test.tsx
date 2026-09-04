import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SELECTION_DELAY_MS,
  useDelayedSelectionId,
} from "./useDelayedSelectionId";

describe("useDelayedSelectionId", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns only the latest selection after it remains selected for the delay", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useDelayedSelectionId(id, SELECTION_DELAY_MS),
      { initialProps: { id: "story-1" } },
    );

    rerender({ id: "story-2" });
    act(() => vi.advanceTimersByTime(300));
    rerender({ id: "story-3" });
    act(() => vi.advanceTimersByTime(SELECTION_DELAY_MS - 1));

    expect(result.current).toBeNull();

    act(() => vi.advanceTimersByTime(1));

    expect(result.current).toBe("story-3");

    rerender({ id: "story-1" });
    expect(result.current).toBeNull();

    act(() => vi.advanceTimersByTime(SELECTION_DELAY_MS));

    expect(result.current).toBe("story-1");
  });
});
