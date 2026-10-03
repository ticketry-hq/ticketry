import { describe, expect, it } from "vitest";

import type { PlanningGraphQuery } from "./generated/planningGraph.documents";
import { adaptPlanningGraph, isTopLevelIn, backlogCandidates } from "./planningModel";
import { graphOf, workItem } from "./testGraph";

const module = (id: string, sequenceId: number, rank: string | null) => ({
  id,
  name: id,
  sequenceId,
  presentation: { nodes: rank === null ? [] : [{ moduleId: id, rank, tabHidden: false }] },
});

describe("adaptPlanningGraph", () => {
  it("orders modules by manual tab rank, then by sequence, and keys items by slug", () => {
    const graph = adaptPlanningGraph({
      project: { nodes: [{ id: "p1", name: "Planner", slug: "PLAN" }] },
      states: { nodes: [] },
      issueTypes: { nodes: [{ id: "story-type", name: "Story", level: "task" }, { id: "epic-type", name: "Module", level: "module" }] },
      sprints: { nodes: [] },
      modules: { nodes: [module("late", 9, null), module("second", 1, "k"), module("first", 5, "F"), module("early", 2, null)] },
      workItems: {
        nodes: [
          {
            id: "w",
            name: "W",
            sequenceId: 42,
            rank: "V",
            parentId: null,
            moduleId: null,
            stateId: null,
            stateRevision: 1,
            sprintId: null,
            updatedAt: "2026-09-01 00:00:00",
            issueType: { id: "t", name: "Story" },
          },
        ],
      },
    } satisfies PlanningGraphQuery);
    expect(graph.modules.map((m) => m.id)).toEqual(["first", "second", "early", "late"]);
    expect(graph.workItems[0].key).toBe("PLAN-42");
  });

  const typed = (types: Array<{ id: string; name: string; level: string }>) =>
    adaptPlanningGraph({
      project: { nodes: [] },
      states: { nodes: [] },
      issueTypes: { nodes: types },
      sprints: { nodes: [] },
      modules: { nodes: [] },
      workItems: { nodes: [] },
    } satisfies PlanningGraphQuery);

  it("resolves exactly one task type named Story, or says why it can't", () => {
    const storyType = (types: Parameters<typeof typed>[0]) => typed(types).storyType;
    expect(storyType([{ id: "m", name: "Story", level: "module" }, { id: "s", name: "Story", level: "task" }])).toEqual({ id: "s" });
    expect(storyType([{ id: "t", name: "Task", level: "task" }])).toEqual({
      error: "No Story issue type is configured for this project.",
    });
    expect(storyType([{ id: "a", name: "Story", level: "task" }, { id: "b", name: "Story", level: "task" }])).toEqual({
      error: "More than one Story issue type is configured; keep one to create issues here.",
    });
  });

  it("resolves exactly one module-level epic type, or says why it can't", () => {
    const epicType = (types: Parameters<typeof typed>[0]) => typed(types).epicType;
    expect(epicType([{ id: "s", name: "Story", level: "task" }, { id: "m", name: "Module", level: "module" }])).toEqual({ id: "m" });
    expect(epicType([{ id: "s", name: "Story", level: "task" }])).toEqual({
      error: "No module-level Epic issue type is configured for this project.",
    });
    expect(epicType([{ id: "a", name: "Module", level: "module" }, { id: "b", name: "Epic", level: "module" }])).toEqual({
      error: "More than one module-level issue type is configured; keep one to create epics here.",
    });
  });
});


describe("project planning read contracts", () => {
  it("reads sprint identity and membership without importing deferred sprint fields", () => {
    const sprintId = "f7e76bd0-b778-4539-824a-6e04b881a11a";
    const legacySprint = {
      id: sprintId, name: "Sprint one", status: "planned",
      createdAt: "2026-09-01 00:00:00",
      startDate: null, endDate: null, goal: "Legacy source goal",
    };
    const graph = adaptPlanningGraph({
      project: { nodes: [{ id: "project", name: "Planning", slug: "PLAN" }] },
      states: { nodes: [] },
      issueTypes: { nodes: [] },
      modules: { nodes: [] },
      sprints: { nodes: [legacySprint] },
      workItems: { nodes: [{
        id: "story", name: "Story", sequenceId: 7, rank: "V",
        parentId: null, moduleId: null, stateId: null, stateRevision: 1,
        sprintId, updatedAt: "2026-09-01 00:00:00", issueType: null,
      }] },
    } satisfies PlanningGraphQuery);
    expect(graph.sprints).toEqual([{
      id: sprintId, name: "Sprint one", status: "planned", createdAt: "2026-09-01 00:00:00",
    }]);
    expect(graph.workItems[0].sprintId).toBe(sprintId);
  });
});


describe("planning membership", () => {
  it("treats unparented, epic-parented, and orphan stories as top-level", () => {
    const graph = graphOf([
      workItem({ id: "root" }),
      workItem({ id: "epic-story", parentId: "m1" }),
      workItem({ id: "orphan", parentId: "archived-parent" }),
      workItem({ id: "nested", parentId: "root" }),
    ]);
    expect(graph.workItems.filter(isTopLevelIn(graph)).map((item) => item.id)).toEqual([
      "root", "epic-story", "orphan",
    ]);
  });

  it("offers only unassigned top-level stories through Implement in the backlog", () => {
    const graph = graphOf([
      workItem({ id: "idea" }),
      workItem({ id: "implement", stateId: "implement", parentId: "m1" }),
      workItem({ id: "review", stateId: "review" }),
      workItem({ id: "done", stateId: "done" }),
      workItem({ id: "assigned", sprintId: "sprint" }),
      workItem({ id: "nested", parentId: "idea" }),
      workItem({ id: "task", typeName: "Task" }),
      workItem({ id: "unclassified", typeName: null }),
      workItem({ id: "no-state", stateId: null }),
    ]);
    expect(backlogCandidates(graph).map((item) => item.id)).toEqual(["idea", "implement"]);
  });
});
