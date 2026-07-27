import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "../features/work-items/stores/selectionStore";

const sel = () => useSelectionStore.getState();
const idsArr = () => [...sel().ids];

beforeEach(() => {
  useSelectionStore.setState({ surface: null, ids: new Set(), anchorId: null });
});

describe("selectionStore · toggle", () => {
  it("adds an id and pins it as the anchor", () => {
    sel().toggle("backlog", "a");
    expect(idsArr()).toEqual(["a"]);
    expect(sel().surface).toBe("backlog");
    expect(sel().anchorId).toBe("a");
  });

  it("removes an already-selected id (and still re-pins the anchor)", () => {
    sel().toggle("backlog", "a");
    sel().toggle("backlog", "b");
    expect(idsArr()).toEqual(["a", "b"]);
    sel().toggle("backlog", "a");
    expect(idsArr()).toEqual(["b"]);
    expect(sel().anchorId).toBe("a");
  });

});

describe("selectionStore · range", () => {
  const ORDER = ["a", "b", "c", "d", "e"];

  it("selects the inclusive slice between the anchor and the target", () => {
    sel().toggle("backlog", "b"); // anchor = b
    sel().range("backlog", "d", ORDER);
    expect(idsArr().sort()).toEqual(["b", "c", "d"]);
    expect(sel().anchorId).toBe("b"); // anchor unchanged
  });

  it("works when the target is before the anchor in the list", () => {
    sel().toggle("backlog", "d"); // anchor = d
    sel().range("backlog", "b", ORDER);
    expect(idsArr().sort()).toEqual(["b", "c", "d"]);
  });

  it("unions the range into a prior ⌘-click selection", () => {
    sel().toggle("backlog", "a"); // anchor a, {a}
    sel().toggle("backlog", "c"); // anchor c, {a,c}
    sel().range("backlog", "e", ORDER); // c..e
    expect(idsArr().sort()).toEqual(["a", "c", "d", "e"]);
  });

  it("degrades to a single select when there is no anchor", () => {
    sel().range("backlog", "c", ORDER);
    expect(idsArr()).toEqual(["c"]);
    expect(sel().anchorId).toBe("c");
  });

});

describe("selectionStore · replace & clear", () => {
  it("replace swaps the whole set and drops the anchor", () => {
    sel().toggle("backlog", "a");
    sel().replace("backlog", ["x", "y"]);
    expect(idsArr().sort()).toEqual(["x", "y"]);
    expect(sel().anchorId).toBeNull();
    expect(sel().surface).toBe("backlog");
  });

  it("clear empties the set, anchor, and surface", () => {
    sel().toggle("backlog", "a");
    sel().clear();
    expect(idsArr()).toEqual([]);
    expect(sel().surface).toBeNull();
    expect(sel().anchorId).toBeNull();
  });
});
