import { describe, it, expect } from "vitest";
import { compareStateOrder } from "./display";

// CODIN-859: sort_order is the primary workflow ordering key. Refinement/Ready
// share the unstarted group and Implement/Review share started, so group rank
// alone cannot order them — sort_order must.
describe("compareStateOrder", () => {
  it("orders two same-group states by sort_order, not group rank", () => {
    const refinement = { group: "unstarted", sort_order: 1 };
    const ready = { group: "unstarted", sort_order: 2 };
    // Group rank is equal for both, so only sort_order can order them.
    expect(compareStateOrder(refinement, ready)).toBeLessThan(0);
    expect(compareStateOrder(ready, refinement)).toBeGreaterThan(0);
  });

  it("falls back to group rank when sort_order is absent", () => {
    const backlog = { group: "backlog" };
    const started = { group: "started" };
    expect(compareStateOrder(backlog, started)).toBeLessThan(0);
  });

  it("falls back to group rank when sort_order ties", () => {
    const a = { group: "backlog", sort_order: 0 };
    const b = { group: "started", sort_order: 0 };
    expect(compareStateOrder(a, b)).toBeLessThan(0);
  });
});
