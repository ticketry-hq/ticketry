import { describe, expect, it } from "vitest";

import type { Module } from "../projects";
import type { ModulePresentation } from "../projects";
import { visibleModules } from "./modulePresentation";

const MODULES: Module[] = [
  { id: "module-a", name: "Alpha", is_archived: false, project_id: "project", sequence_id: 1, key: "PRJ-1", issue_type: "type", rank: "", project: null },
  { id: "module-b", name: "Bravo", is_archived: true, project_id: "project", sequence_id: 2, key: "PRJ-2", issue_type: "type", rank: "", project: null },
  { id: "module-c", name: "Charlie", is_archived: false, project_id: "project", sequence_id: 1, key: "PRJ-1", issue_type: "type", rank: "", project: null },
  { id: "module-d", name: "Delta", is_archived: false, project_id: "project", sequence_id: 1, key: "PRJ-1", issue_type: "type", rank: "", project: null },
];

describe("visibleModules", () => {
  it("keeps canonical order while hidden and archived modules consume no positions", () => {
    const presentations = [
      { module_id: "module-c", rank: "00000003", tab_hidden: true },
    ] as ModulePresentation[];

    expect(visibleModules(MODULES, presentations).map((module) => module.id))
      .toEqual(["module-a", "module-d"]);
  });
});
