import { describe, expect, it } from "vitest";
import { orderedTaskSections } from "../features/studio/lib/taskTree";
import type {
  TaskState,
  TaskSummary,
} from "../features/studio/lib/types";

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
    rank,
    state,
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: "module-1",
    sub_issues_count: 0,
  };
}

function orderedIds(tasks: TaskSummary[]): string[] {
  return orderedTaskSections(tasks, [state])[0]?.tasks.map(({ id }) => id) ?? [];
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
