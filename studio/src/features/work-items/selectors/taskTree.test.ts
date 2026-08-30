import { describe, expect, it } from "vitest";
import type { ModuleTree } from "../../../shared/api/types";
import {
  descendantIdsByRowId,
  visibleRows,
  type TreeWorkItem,
} from "./taskTree";

const tree: ModuleTree = {
  rootIds: ["parent"],
  children: {
    parent: ["child", "sibling"],
    child: ["grandchild"],
    sibling: [],
    grandchild: [],
  },
  order: ["parent", "child", "grandchild", "sibling"],
};

const itemsById = Object.fromEntries(
  tree.order.map((id) => [
    id,
    {
      id,
      name: id,
      sequence_id: null,
      parent_id:
        id === "parent" ? null : id === "grandchild" ? "child" : "parent",
      state: "state-1",
    } satisfies TreeWorkItem,
  ]),
);

describe("Stories tree descendants", () => {
  it("supplies descendant ids only while a branch is collapsed", () => {
    const collapsedRows = visibleRows(
      tree,
      tree.rootIds,
      itemsById,
      new Set(),
    );
    expect(descendantIdsByRowId(tree, collapsedRows)).toEqual({
      parent: ["sibling", "child", "grandchild"],
    });

    const expandedRows = visibleRows(
      tree,
      tree.rootIds,
      itemsById,
      new Set(["parent"]),
    );
    expect(descendantIdsByRowId(tree, expandedRows)).toEqual({
      parent: [],
      child: ["grandchild"],
      sibling: [],
    });
  });
});
