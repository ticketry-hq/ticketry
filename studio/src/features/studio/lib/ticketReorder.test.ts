import { describe, expect, it } from "vitest";
import {
  resolveTicketReorderNeighbors,
  type VisibleRootBlock,
} from "./ticketReorder";

const blocks: VisibleRootBlock[] = [
  { rootId: "top", rowIds: ["top"] },
  { rootId: "middle", rowIds: ["middle", "middle-child"] },
  { rootId: "bottom", rowIds: ["bottom"] },
];

describe("resolveTicketReorderNeighbors", () => {
  it("reaches the visible top and inverts it to canonical neighbors", () => {
    expect(
      resolveTicketReorderNeighbors(blocks, "bottom", "top", "near"),
    ).toEqual({ beforeId: "top", afterId: null });
  });

  it("resolves a middle seam in canonical rank order", () => {
    expect(
      resolveTicketReorderNeighbors(blocks, "bottom", "middle", "near"),
    ).toEqual({ beforeId: "middle", afterId: "top" });
  });

  it("reaches the visible bottom and inverts it to canonical neighbors", () => {
    expect(
      resolveTicketReorderNeighbors(blocks, "top", "bottom", "far"),
    ).toEqual({ beforeId: null, afterId: "bottom" });
  });

  it("maps a hovered descendant to its entire root block", () => {
    expect(
      resolveTicketReorderNeighbors(
        blocks,
        "bottom",
        "middle-child",
        "near",
      ),
    ).toEqual({ beforeId: "middle", afterId: "top" });
  });

  it("resolves a source from another state and a header to destination-only neighbors", () => {
    expect(
      resolveTicketReorderNeighbors(blocks, "other-state", "middle", "far"),
    ).toEqual({ beforeId: "bottom", afterId: "middle" });
    expect(
      resolveTicketReorderNeighbors(blocks, "other-state", null, "near"),
    ).toEqual({ beforeId: "top", afterId: null });
    expect(
      resolveTicketReorderNeighbors([], "other-state", null, "near"),
    ).toEqual({ beforeId: null, afterId: null });
  });

  it("rejects self, unchanged, and unknown drops", () => {
    expect(
      resolveTicketReorderNeighbors(blocks, "middle", "middle-child", "far"),
    ).toBeNull();
    expect(
      resolveTicketReorderNeighbors(blocks, "top", "middle", "near"),
    ).toBeNull();
    expect(
      resolveTicketReorderNeighbors(blocks, "top", "missing", "far"),
    ).toBeNull();
  });
});
