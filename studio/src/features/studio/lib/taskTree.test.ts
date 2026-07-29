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
    rank,
    state: TODO,
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: "module-1",
    sub_issues_count: 0,
  };
}

describe("orderedTaskSections", () => {
  it("sorts workflow-state tickets by rank descending", () => {
    const [section] = orderedTaskSections(
      [task("low", "F"), task("high", "kV"), task("middle", "V")],
      [TODO],
    );

    expect(section.tasks.map(({ id }) => id)).toEqual([
      "high",
      "middle",
      "low",
    ]);
  });

  it("places missing ranks last while preserving the previous reversed order", () => {
    const [section] = orderedTaskSections(
      [
        task("missing-first"),
        task("ranked", "V"),
        task("missing-second"),
      ],
      [TODO],
    );

    expect(section.tasks.map(({ id }) => id)).toEqual([
      "ranked",
      "missing-second",
      "missing-first",
    ]);
  });
});
