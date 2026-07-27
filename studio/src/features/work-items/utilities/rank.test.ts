import { describe, expect, it } from "vitest";
import { rankBetween } from "./rank";

// rankBetween mirrors worktracker/ranking.py::key_between. These anchors are
// the exact strings the Python implementation produces, locking the two ports
// together (the server stays the source of truth, but the optimistic placement
// must agree with it).
describe("rankBetween — parity with the server", () => {
  it("matches the Python anchors", () => {
    expect(rankBetween(null, null)).toBe("V");
    expect(rankBetween(null, "V")).toBe("FV");
    expect(rankBetween("V", null)).toBe("kV");
    expect(rankBetween("V", "kV")).toBe("ckV");
  });
});

describe("rankBetween — ordering invariants", () => {
  it("sorts strictly between two keys", () => {
    const mid = rankBetween("V", "kV");
    expect("V" < mid && mid < "kV").toBe(true);
  });

  it("null-left sorts before, null-right sorts after", () => {
    expect(rankBetween(null, "V") < "V").toBe(true);
    expect(rankBetween("V", null) > "V").toBe(true);
  });

  it("repeated midpoints at one spot stay strictly ordered and unique", () => {
    const hi = rankBetween("V", null);
    let prev = "V";
    const seen = new Set([prev, hi]);
    for (let i = 0; i < 50; i++) {
      const mid = rankBetween(prev, hi);
      expect(prev < mid && mid < hi).toBe(true);
      expect(seen.has(mid)).toBe(false);
      seen.add(mid);
      prev = mid;
    }
  });

  it("throws on inverted neighbors", () => {
    expect(() => rankBetween("kV", "V")).toThrow();
    expect(() => rankBetween("V", "V")).toThrow();
  });
});
