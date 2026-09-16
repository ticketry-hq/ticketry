import { afterEach, expect, it, vi } from "vitest";
import { consumeLocalWorkItemConvergence, recordLocalWorkItemConvergence } from "./workItemConvergence";

afterEach(() => { vi.runAllTimers(); vi.useRealTimers(); });

it.each([
  ["2026-09-05 00:00:00", "2026-09-05T00:00:00+00:00"],
  ["2026-09-05 00:00:00.123456789", "2026-09-05T05:30:00.123456789+05:30"],
  ["2026-09-05 00:00:00.123400", "2026-09-05T00:00:00.1234Z"],
])("matches mutation %s to event %s", (mutation, event) => {
  vi.useFakeTimers();
  recordLocalWorkItemConvergence("item-1", mutation);
  expect(consumeLocalWorkItemConvergence("item-1", event)).toBe(true);
  expect(consumeLocalWorkItemConvergence("item-1", event)).toBe(false);
});

it("does not swallow distinct writes within a millisecond or another identity", () => {
  vi.useFakeTimers();
  recordLocalWorkItemConvergence("item-1", "2026-09-05 00:00:00.123456");
  expect(consumeLocalWorkItemConvergence("item-1", "2026-09-05T00:00:00.123457Z")).toBe(false);
  expect(consumeLocalWorkItemConvergence("item-2", "2026-09-05T00:00:00.123456Z")).toBe(false);
  expect(consumeLocalWorkItemConvergence("item-1", "2026-09-05T00:00:00.123456Z")).toBe(true);
});
