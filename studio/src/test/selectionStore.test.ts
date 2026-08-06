import { beforeEach, describe, expect, it } from "vitest";
import { useClientStore } from "../state/clientStore";

const sel = () => useClientStore.getState();
const idsArr = () => [...sel().selection.ids];

beforeEach(() => {
  useClientStore.setState({
    selection: { surface: null, ids: new Set(), anchorId: null },
  });
});

describe("selectionStore · toggle", () => {
  it("adds an id and pins it as the anchor", () => {
    sel().selectionToggle("backlog", "a");
    expect(idsArr()).toEqual(["a"]);
    expect(sel().selection.surface).toBe("backlog");
    expect(sel().selection.anchorId).toBe("a");
  });

  it("removes an already-selected id (and still re-pins the anchor)", () => {
    sel().selectionToggle("backlog", "a");
    sel().selectionToggle("backlog", "b");
    expect(idsArr()).toEqual(["a", "b"]);
    sel().selectionToggle("backlog", "a");
    expect(idsArr()).toEqual(["b"]);
    expect(sel().selection.anchorId).toBe("a");
  });

});

describe("selectionStore · range", () => {
  const ORDER = ["a", "b", "c", "d", "e"];

  it("selects the inclusive slice between the anchor and the target", () => {
    sel().selectionToggle("backlog", "b"); // anchor = b
    sel().selectionRange("backlog", "d", ORDER);
    expect(idsArr().sort()).toEqual(["b", "c", "d"]);
    expect(sel().selection.anchorId).toBe("b"); // anchor unchanged
  });

  it("works when the target is before the anchor in the list", () => {
    sel().selectionToggle("backlog", "d"); // anchor = d
    sel().selectionRange("backlog", "b", ORDER);
    expect(idsArr().sort()).toEqual(["b", "c", "d"]);
  });

  it("unions the range into a prior ⌘-click selection", () => {
    sel().selectionToggle("backlog", "a"); // anchor a, {a}
    sel().selectionToggle("backlog", "c"); // anchor c, {a,c}
    sel().selectionRange("backlog", "e", ORDER); // c..e
    expect(idsArr().sort()).toEqual(["a", "c", "d", "e"]);
  });

  it("degrades to a single select when there is no anchor", () => {
    sel().selectionRange("backlog", "c", ORDER);
    expect(idsArr()).toEqual(["c"]);
    expect(sel().selection.anchorId).toBe("c");
  });

});

describe("selectionStore · replace & clear", () => {
  it("replace swaps the whole set and drops the anchor", () => {
    sel().selectionToggle("backlog", "a");
    sel().selectionReplace("backlog", ["x", "y"]);
    expect(idsArr().sort()).toEqual(["x", "y"]);
    expect(sel().selection.anchorId).toBeNull();
    expect(sel().selection.surface).toBe("backlog");
  });

  it("clear empties the set, anchor, and surface", () => {
    sel().selectionToggle("backlog", "a");
    sel().selectionClear();
    expect(idsArr()).toEqual([]);
    expect(sel().selection.surface).toBeNull();
    expect(sel().selection.anchorId).toBeNull();
  });
});
