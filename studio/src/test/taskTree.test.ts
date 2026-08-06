import { describe, expect, it } from "vitest";
import {
  orderedTaskSections,
  searchHits,
  visibleRows,
} from "../features/studio/lib/taskTree";
import type {
  TaskState,
  TaskSummary,
} from "../features/studio/lib/types";
import { moduleTreeFromWorkItems } from "../shared/api/client";
import type { WorkItem } from "../shared/api/types";

const state: TaskState = {
  id: "state-1",
  name: "Implement",
  group: "started",
  color: null,
};

function task(id: string, rank?: string): TaskSummary {
  return {
    id,
    name: id,
    project_id: "project-1",
    sequence_id: null,
    issue_type: { id: "type-story", name: "Story", level: "task" },
    rank,
    state,
    description: null,
    parent_id: "module-1",
    sub_issues_count: 0,
  };
}

function orderedIds(tasks: TaskSummary[]): string[] {
  return orderedTaskSections(
    tasks.map(({ id }) => id),
    Object.fromEntries(tasks.map((item) => [item.id, item])),
    [state],
  )[0]?.ids ?? [];
}

describe("orderedTaskSections", () => {
  it("sorts server-ranked tickets by fractional rank descending", () => {
    expect(
      orderedIds([
        task("lowest", "0"),
        task("middle", "H"),
        task("highest", "z"),
      ]),
    ).toEqual(["highest", "middle", "lowest"]);
  });

  it("puts both inverted-order boundaries in visible descending order", () => {
    expect(orderedIds([task("canonical-first", "1"), task("canonical-last", "y")]))
      .toEqual(["canonical-last", "canonical-first"]);
  });

  it("keeps the legacy visible order for absent ranks after ranked tickets", () => {
    expect(
      orderedIds([
        task("cached-first"),
        task("ranked-low", "A"),
        task("cached-second", ""),
        task("ranked-high", "B"),
      ]),
    ).toEqual([
      "ranked-high",
      "ranked-low",
      "cached-second",
      "cached-first",
    ]);
  });
});

describe("id-only tree derivations", () => {
  const root = task("root", "A");
  const child = { ...task("child", "B"), parent_id: root.id };
  const itemsById = { root, child };

  it("reduces the module read to ids and order without retaining records", () => {
    const tree = moduleTreeFromWorkItems(
      "module-1",
      [root, child] as unknown as WorkItem[],
    );

    expect(tree).toEqual({
      rootIds: [root.id],
      children: { [root.id]: [child.id], [child.id]: [] },
      order: [root.id, child.id],
    });
    expect(tree).not.toHaveProperty("tasks");
    expect(tree).not.toHaveProperty("subtasks");
  });

  it("distinguishes an unread child collection from a known empty one", () => {
    const unread = visibleRows(
      { rootIds: [root.id], children: {}, order: [root.id] },
      [root.id],
      { root },
      new Set(),
    );
    const childless = visibleRows(
      { rootIds: [root.id], children: { [root.id]: [] }, order: [root.id] },
      [root.id],
      { root },
      new Set(),
    );

    expect(unread[0]).toMatchObject({ id: root.id, expandable: true });
    expect(childless[0]).toMatchObject({ id: root.id, expandable: false });
  });

  it("returns only ids and structural facts while search retains ancestors", () => {
    const tree = {
      rootIds: [root.id],
      children: { [root.id]: [child.id], [child.id]: [] },
      order: [root.id, child.id],
    };
    const hits = searchHits(tree, itemsById, child.name);
    const rows = visibleRows(tree, tree.rootIds, itemsById, new Set(), hits);

    expect(rows).toEqual([
      {
        kind: "work-item",
        id: root.id,
        depth: 0,
        parentId: null,
        expandable: true,
        expanded: true,
      },
      {
        kind: "work-item",
        id: child.id,
        depth: 1,
        parentId: root.id,
        expandable: false,
        expanded: false,
      },
    ]);
    expect(rows.some((row) => "name" in row || "state" in row || "rank" in row))
      .toBe(false);
  });
});
