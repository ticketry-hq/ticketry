import { expect, it } from "vitest";
import type { Module, ModulePresentation } from "../../shared/api/types";
import { projectModuleTabs } from "./index";

const projectId = "projection-project";
const moduleRecord = (id: string, is_archived = false): Module => ({
  id, project_id: projectId, is_archived, name: id, key: id, sequence_id: 1, issue_type: "module",
});
const presentation = (module_id: string): ModulePresentation => ({ module_id, tab_hidden: true, rank: "a" });
const membership = (module_id: string, sprint_id: string | null) => ({
  project_id: projectId, parent_id: module_id, module_id, sprint_id, is_archived: false,
});

it("classifies every archive, hidden and sprint overlap using one precedence and tab set", () => {
  const result = projectModuleTabs({
    projectId, modulesComplete: true, filterGeneration: 3, selection: { mode: "id", sprintId: "sprint" },
    modules: [moduleRecord("open"), moduleRecord("outside"), moduleRecord("hidden-in"),
      moduleRecord("hidden-out"), moduleRecord("archived-in", true), moduleRecord("archived-out", true),
      moduleRecord("archived-hidden-in", true), moduleRecord("archived-hidden-out", true)],
    presentations: [presentation("hidden-in"), presentation("hidden-out"),
      presentation("archived-hidden-in"), presentation("archived-hidden-out")],
    index: { complete: true, roots: [membership("open", "sprint"), membership("hidden-in", "sprint"),
      membership("archived-in", "sprint"), membership("archived-hidden-in", "sprint")] },
  });
  expect(result.entries.map(({ module, status, sprintEligible }) => [module.id, status, sprintEligible])).toEqual([
    ["open", "open", true], ["outside", "not-in-sprint", false],
    ["hidden-in", "hidden", true], ["hidden-out", "hidden", false],
    ["archived-in", "archived", true], ["archived-out", "archived", false],
    ["archived-hidden-in", "archived", true], ["archived-hidden-out", "archived", false],
  ]);
  expect(result.modules.map(({ id }) => id)).toEqual(["open"]);
  expect(result).toMatchObject({ projectId, filterGeneration: 3, restricted: true, complete: true, loading: false, noMatches: false });
});

it("ordinary tabs do not wait for sprint reads and retain canonical project order", () => {
  const result = projectModuleTabs({ projectId, modulesComplete: true, filterGeneration: 4,
    selection: { mode: "all" }, index: { complete: false, roots: [] },
    modules: [moduleRecord("second"), moduleRecord("hidden"), moduleRecord("archived", true),
      { ...moduleRecord("other-project"), project_id: "other" }, moduleRecord("first")],
    presentations: [presentation("hidden")],
  });
  expect(result.modules.map(({ id }) => id)).toEqual(["second", "first"]);
  expect(result.entries.map(({ module, status, sprintEligible }) => [module.id, status, sprintEligible])).toEqual([
    ["second", "open", true], ["hidden", "hidden", true], ["archived", "archived", true], ["first", "open", true],
  ]);
  expect(result).toMatchObject({ restricted: false, complete: true, loading: false, noMatches: false });
});

it("does not claim presentation is complete before hidden flags have loaded", () => {
  const result = projectModuleTabs({ projectId, modulesComplete: true, filterGeneration: 0,
    selection: { mode: "all" }, index: { complete: true, roots: [] },
    modules: [moduleRecord("pending")], presentations: undefined,
  });
  expect(result).toMatchObject({ complete: false, loading: true, noMatches: false });
  expect(result.modules.map(({ id }) => id)).toEqual(["pending"]);
});

it("unsprinted membership uses active top-level stories and respects explicit close", () => {
  const result = projectModuleTabs({ projectId, modulesComplete: true, filterGeneration: 1,
    selection: { mode: "none" }, presentations: [presentation("hidden")],
    modules: [moduleRecord("open"), moduleRecord("hidden"), moduleRecord("archived-story"),
      moduleRecord("descendant-only"), moduleRecord("foreign-story"), moduleRecord("sprinted")],
    index: { complete: true, roots: [membership("open", null), membership("hidden", null),
      { ...membership("archived-story", null), is_archived: true },
      { ...membership("descendant-only", null), parent_id: "parent-story" },
      { ...membership("foreign-story", null), project_id: "other-project" }, membership("sprinted", "sprint")] },
  });
  expect(result.modules.map(({ id }) => id)).toEqual(["open"]);
  expect(result.entries.map(({ status }) => status)).toEqual([
    "open", "hidden", "not-in-sprint", "not-in-sprint", "not-in-sprint", "not-in-sprint",
  ]);
});

it.each([
  ["membership", false, true, { mode: "none" } as const],
  ["project modules", true, false, { mode: "none" } as const],
  ["active sprint resolution", true, true, null],
])("keeps ordinary fallback without definitive out-of-sprint statuses while %s is incomplete", (_read, indexComplete, modulesComplete, selection) => {
  const result = projectModuleTabs({ projectId, modulesComplete, filterGeneration: 1,
    selection, index: { complete: indexComplete, roots: [] },
    modules: [moduleRecord("open"), moduleRecord("hidden"), moduleRecord("archived", true)],
    presentations: [presentation("hidden")],
  });
  expect(result.modules.map(({ id }) => id)).toEqual(["open"]);
  expect(result.entries.map(({ status, sprintEligible }) => [status, sprintEligible])).toEqual([
    ["open", null], ["hidden", null], ["archived", null],
  ]);
  expect(result).toMatchObject({ complete: false, loading: true, noMatches: false });
});

it("reports an empty match only after a complete restriction, even if every match was closed", () => {
  const result = projectModuleTabs({ projectId, modulesComplete: true, filterGeneration: 1,
    selection: { mode: "id", sprintId: "sprint" }, presentations: [presentation("hidden")],
    modules: [moduleRecord("hidden"), moduleRecord("outside")],
    index: { complete: true, roots: [membership("hidden", "sprint")] },
  });
  expect(result.modules).toEqual([]);
  expect(result.entries.map(({ status }) => status)).toEqual(["hidden", "not-in-sprint"]);
  expect(result).toMatchObject({ complete: true, loading: false, noMatches: true });
});

it("exposes scope generation independently of tab presentation changes", () => {
  const input = { projectId, modulesComplete: true, filterGeneration: 7,
    selection: { mode: "all" } as const, presentations: [], modules: [moduleRecord("open")],
    index: { complete: false, roots: [] },
  };
  const open = projectModuleTabs(input);
  const closed = projectModuleTabs({ ...input, presentations: [presentation("open")] });
  const changedFilter = projectModuleTabs({ ...input, filterGeneration: 8 });
  const changedProject = projectModuleTabs({ ...input, projectId: "another-project" });
  expect(closed.filterGeneration).toBe(7);
  expect(closed.generation).not.toBe(open.generation);
  expect(changedFilter.filterGeneration).toBe(8);
  expect(changedFilter.generation).not.toBe(open.generation);
  expect(changedProject.projectId).toBe("another-project");
  expect(changedProject.generation).not.toBe(open.generation);
});

it("distinguishes returning to the same project from its previous visit", () => {
  const input = { projectId, projectGeneration: 2, modulesComplete: true, filterGeneration: 7,
    selection: { mode: "all" } as const, presentations: [], modules: [moduleRecord("open")],
    index: { complete: false, roots: [] },
  };
  const previousVisit = projectModuleTabs(input);
  const returnedVisit = projectModuleTabs({ ...input, projectGeneration: 4 });
  expect(previousVisit).toMatchObject({ projectId: "projection-project", projectGeneration: 2, filterGeneration: 7 });
  expect(returnedVisit).toMatchObject({ projectId: "projection-project", projectGeneration: 4, filterGeneration: 7 });
  expect(returnedVisit.generation).not.toBe(previousVisit.generation);
});
