import { describe, expect, it } from "vitest";

import { arrivalRank } from "./arrivalRank";

describe("arrivalRank", () => {
  it("inserts before the first active ranked item in the destination state", () => {
    const items = [
      { state_id: "ready", rank: "A", is_archived: true },
      { state_id: "doing", rank: "FV", is_archived: false },
      { state_id: "ready", rank: "kV", is_archived: false },
      { state_id: "ready", rank: "V", is_archived: false },
    ];

    expect(arrivalRank(items, "ready")).toBe("FV");
  });

  it("returns a valid rank for an empty destination state", () => {
    expect(arrivalRank([], "ready")).toBe("V");
  });
});
