import { describe, expect, it } from "vitest";

import { graphOf, MODULES, sprint, workItem } from "../../planning-graph/testGraph";
import { groupSprintItemsByEpic } from "../selectors/sprintSelectors";
import { backlogCandidates, groupByEpic, planSummary, sprintPaneGroups } from "./planGroups";
import { epicOf, NO_EPIC, planEpics } from "./epicMembership";

const ids = (groups: { epic: { id: string }; items: { id: string }[] }[]) =>
  groups.map((group) => [group.epic.id, group.items.map((item) => item.id)]);

describe("plan groups", () => {
  const epics = planEpics(MODULES);
  const items = [workItem({ id: "a", moduleId: "m1" }), workItem({ id: "b", moduleId: null })];

  it("ends the epic list with No epic", () => {
    expect(epics.map((epic) => epic.id)).toEqual(["m1", "m2", NO_EPIC]);
  });

  it("files a null or unknown module under No epic", () => {
    expect(epicOf(workItem({ id: "x", moduleId: "m2" }), epics)).toBe("m2");
    expect(epicOf(workItem({ id: "x", moduleId: null }), epics)).toBe(NO_EPIC);
    expect(epicOf(workItem({ id: "x", moduleId: "gone" }), epics)).toBe(NO_EPIC);
  });

  it("keeps every chosen epic, even an empty one", () => {
    const groups = groupByEpic(epics, [...items, workItem({ id: "c", moduleId: "gone" })], new Set(["m2", NO_EPIC]));
    expect(ids(groups)).toEqual([
      ["m2", []],
      [NO_EPIC, ["b", "c"]],
    ]);
  });

  it("drops empty groups when showing everything", () => {
    expect(groupByEpic(epics, items).map((group) => group.epic.id)).toEqual(["m1", NO_EPIC]);
  });
});

describe("backlog candidates", () => {
  it("uses the configured order through Implement and excludes later, unknown and unset states", () => {
    const graph = graphOf([
      ...["idea", "custom", "implement", "review", "done", "cancelled", "missing"].map((stateId) => workItem({ id: stateId, stateId })),
      workItem({ id: "unset", stateId: null }),
      workItem({ id: "assigned-review", stateId: "review", sprintId: "s" }),
    ]);
    graph.states = [
      { id: "idea", name: "Ideas", group: "backlog", color: "" },
      { id: "custom", name: "Custom preparation", group: "started", color: "" },
      { id: "implement", name: "Implement", group: "started", color: "" },
      { id: "review", name: "Review", group: "started", color: "" },
      { id: "done", name: "Done", group: "completed", color: "" },
      { id: "cancelled", name: "Cancelled", group: "cancelled", color: "" },
    ];
    expect(backlogCandidates(graph).map((item) => item.id)).toEqual(["idea", "custom", "implement"]);
    graph.states = [graph.states[0], graph.states[2], graph.states[1], ...graph.states.slice(3)];
    expect(backlogCandidates(graph).map((item) => item.id)).toEqual(["idea", "implement"]);
    graph.states = graph.states.filter((state) => state.name !== "Implement");
    expect(backlogCandidates(graph)).toEqual([]);
  });

  it("keeps unplanned top-level Stories under any parent category", () => {
    const graph = graphOf([
      workItem({ id: "root" }),
      workItem({ id: "underModule", parentId: "m1", moduleId: "m1" }),
      workItem({ id: "orphan", parentId: "deleted" }),
      workItem({ id: "unknownModule", moduleId: "gone" }),
      workItem({ id: "nested", parentId: "root" }),
      workItem({ id: "task", typeName: "Task" }),
      workItem({ id: "planned", sprintId: "s" }),
    ]);
    expect(backlogCandidates(graph).map((item) => item.id)).toEqual(["root", "underModule", "orphan", "unknownModule"]);
  });
});

describe("sprint pane", () => {
  const epics = planEpics(MODULES);
  const assigned = [
    workItem({ id: "story", sprintId: "s", moduleId: "m1" }),
    workItem({ id: "nested", sprintId: "s", moduleId: "m1", parentId: "story" }),
    workItem({ id: "task", sprintId: "s", typeName: "Task", moduleId: "gone" }),
    workItem({ id: "loose", sprintId: "s" }),
    workItem({ id: "other", sprintId: "t", moduleId: "m2" }),
  ];
  const groups = groupSprintItemsByEpic(graphOf(assigned), sprint({ id: "s" }));

  it("shows every assigned item, plus chosen empty epics, with the focused epic first", () => {
    expect(ids(sprintPaneGroups(epics, groups, new Set(["m2"])))).toEqual([
      ["m2", []],
      ["m1", ["story", "nested"]],
      [NO_EPIC, ["task", "loose"]],
    ]);
    expect(ids(sprintPaneGroups(epics, groups, new Set()))).toEqual([
      ["m1", ["story", "nested"]],
      [NO_EPIC, ["task", "loose"]],
    ]);
  });

  it("counts all items and occupied epics, No epic once", () => {
    expect(planSummary(groups)).toEqual({ items: 4, epics: 2 });
    expect(planSummary([])).toEqual({ items: 0, epics: 0 });
  });
});
