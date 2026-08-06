import { describe, expect, it } from "vitest";
import { orderedTaskSections } from "./taskTree";
import type { TaskState, TaskSummary } from "./types";

const TODO: TaskState = {
  id: "todo",
  name: "Todo",
  group: "backlog",
  color: null,
};

function task(id: string, rank?: string): TaskSummary {
  return {
    id,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    issue_type: { id: "type-story", name: "Story", level: "task" },
    rank,
    state: TODO,
    description: null,
    parent_id: "module-1",
    sub_issues_count: 0,
  };
}

describe("orderedTaskSections", () => {
  it("sorts workflow-state tickets by rank descending", () => {
    const [section] = orderedTaskSections(
      ["low", "high", "middle"],
      Object.fromEntries(
        [task("low", "F"), task("high", "kV"), task("middle", "V")]
          .map((item) => [item.id, item]),
      ),
      [TODO],
    );

    expect(section.ids).toEqual([
      "high",
      "middle",
      "low",
    ]);
  });

  it("places missing ranks last while preserving the previous reversed order", () => {
    const [section] = orderedTaskSections(
      ["missing-first", "ranked", "missing-second"],
      Object.fromEntries([
        task("missing-first"),
        task("ranked", "V"),
        task("missing-second"),
      ].map((item) => [item.id, item])),
      [TODO],
    );

    expect(section.ids).toEqual([
      "ranked",
      "missing-second",
      "missing-first",
    ]);
  });
});
