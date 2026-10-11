import { describe, expect, it } from "vitest";
import { projectRootSprintCounts, selectStorySprintResults, resolveStorySprintFilter } from "./storySprintFilter";
import type { ModuleTree } from "../../../shared/api/types";

const tree: ModuleTree = {
  rootIds: ["a", "b", "none"], order: ["a", "a-child", "b", "b-child", "none"],
  children: { a: ["a-child"], "a-child": [], b: ["b-child"], "b-child": [], none: [] },
};
const items = Object.fromEntries([
  ["a", "Sprint A root", "sprint-a"], ["a-child", "Needle", "sprint-b"],
  ["b", "Sprint B root", "sprint-b"], ["b-child", "Needle", "sprint-a"],
  ["none", "Unassigned root", null],
].map(([id, name, sprint_id]) => [id, { id, name, sprint_id, parent_id: null, state: "todo", sequence_id: null }])) as Record<string, { id:string;name:string;sprint_id:string|null;parent_id:null;state:string;sequence_id:null }>;

describe("Stories sprint resolution", () => {
  it("waits for Active and follows rollover without replacing semantic intent", () => {
    const intent = { mode: "active" } as const;
    expect(resolveStorySprintFilter(intent, { sprint: null, ready: false, loading: true }).selection).toBeNull();
    expect(resolveStorySprintFilter(intent, { sprint: { id: "a" }, ready: true, loading: false }).selection).toEqual({ mode: "id", sprintId: "a" });
    expect(resolveStorySprintFilter(intent, { sprint: { id: "b" }, ready: true, loading: false }).selection).toEqual({ mode: "id", sprintId: "b" });
    expect(resolveStorySprintFilter(intent, { sprint: null, ready: true, loading: false }).selection).toEqual({ mode: "all" });
  });
  it("preserves explicit identity on read failure and only recovers after confirmed absence", () => {
    const intent = { mode: "id", sprintId: "planned" } as const;
    const active = { sprint: { id: "active" }, ready: true, loading: false };
    expect(resolveStorySprintFilter(intent, active, { sprint: null, ready: false, loading: false, error: new Error("Offline") })).toMatchObject({
      selection: { mode: "id", sprintId: "planned" }, status: "error", requiresAllFallback: false,
    });
    expect(resolveStorySprintFilter(intent, active, { sprint: null, ready: true, loading: false })).toMatchObject({
      selection: { mode: "all" }, requiresAllFallback: true,
      notice: "The selected sprint is no longer available. Showing all sprints.",
    });
  });
  it("reports unavailable Active without claiming All and preserves a cached active identity", () => {
    const error = new Error("Offline");
    expect(resolveStorySprintFilter({ mode: "active" }, { sprint: null, ready: false, loading: false, error }))
      .toMatchObject({ selection: null, status: "error", requiresAllFallback: false });
    expect(resolveStorySprintFilter({ mode: "active" }, { sprint: { id: "cached" }, ready: true, loading: false, error }))
      .toMatchObject({ selection: { mode: "id", sprintId: "cached" }, status: "error" });
  });
});

describe("whole-root sprint results", () => {
  it("retains differently assigned child context and prevents excluded child hits reviving a root", () => {
    const filtered = selectStorySprintResults(tree, items, { mode: "id", sprintId: "sprint-a" }, "Needle");
    expect(filtered.eligibleRootIds).toEqual(["a"]);
    expect(filtered.matchingRootIds).toEqual(["a"]);
    expect([...filtered.resultIds]).toEqual(["a-child", "a"]);
  });
  it("All and No sprint match exact roots while result membership ignores collapse", () => {
    expect(selectStorySprintResults(tree, items, { mode: "none" }, "").matchingRootIds).toEqual(["none"]);
    const filtered = selectStorySprintResults(tree, items, { mode: "all" }, "");
    expect(filtered.matchingRootIds).toEqual(["a", "b", "none"]);
    expect([...filtered.resultIds]).toEqual(["a", "a-child", "b", "b-child", "none"]);
  });
  it("counts only direct canonical module roots across the project", () => {
    const counts = projectRootSprintCounts([
      { id: "a", module_id: "opened", parent_id: "opened", sprint_id: "sprint-a" },
      { id: "b", module_id: "unopened", parent_id: "unopened", sprint_id: "sprint-a" },
      { id: "none", module_id: "opened", parent_id: "opened", sprint_id: null },
      { id: "child", module_id: "opened", parent_id: "a", sprint_id: "sprint-a" },
      { id: "orphan", module_id: null, parent_id: null, sprint_id: "sprint-a" },
    ]);
    expect(counts.all).toBe(3);
    expect(counts.none).toBe(1);
    expect(counts.bySprint.get("sprint-a")).toBe(2);
  });
  it("compares normalized sprint identities at the root boundary", () => {
    const compact = "22222222222222222222222222222222";
    const rows = { ...items, a: { ...items.a, sprint_id: compact } };
    expect(selectStorySprintResults(tree, rows, {
      mode: "id", sprintId: "22222222-2222-2222-2222-222222222222",
    }, "").matchingRootIds).toEqual(["a"]);
  });
});
