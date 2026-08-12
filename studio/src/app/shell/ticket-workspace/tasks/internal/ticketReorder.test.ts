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
  it("reaches the visible top in canonical rank order", () => {
    expect(
      resolveTicketReorderNeighbors(blocks, "bottom", "top", "near"),
    ).toEqual({ beforeId: null, afterId: "top" });
  });

  it("resolves a middle seam in canonical rank order", () => {
    expect(
      resolveTicketReorderNeighbors(blocks, "bottom", "middle", "near"),
    ).toEqual({ beforeId: "top", afterId: "middle" });
  });

  it("reaches the visible bottom in canonical rank order", () => {
    expect(
      resolveTicketReorderNeighbors(blocks, "top", "bottom", "far"),
    ).toEqual({ beforeId: "bottom", afterId: null });
  });

  it("maps a hovered descendant to its entire root block", () => {
    expect(
      resolveTicketReorderNeighbors(
        blocks,
        "bottom",
        "middle-child",
        "near",
      ),
    ).toEqual({ beforeId: "top", afterId: "middle" });
  });

  it("resolves a source from another state and a header to destination-only neighbors", () => {
    expect(
      resolveTicketReorderNeighbors(blocks, "other-state", "middle", "far"),
    ).toEqual({ beforeId: "middle", afterId: "bottom" });
    expect(
      resolveTicketReorderNeighbors(blocks, "other-state", null, "near"),
    ).toEqual({ beforeId: null, afterId: "top" });
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
