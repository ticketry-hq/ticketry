import { describe, expect, it } from "vitest";

import type { Module, ModulePresentation } from "../../shared/api/types";
import { visibleModules } from "./modulePresentation";

const MODULES = [
  { id: "module-a", name: "Alpha", is_archived: false },
  { id: "module-b", name: "Bravo", is_archived: true },
  { id: "module-c", name: "Charlie", is_archived: false },
  { id: "module-d", name: "Delta", is_archived: false },
] as Module[];

describe("visibleModules", () => {
  it("keeps canonical order while hidden and archived modules consume no positions", () => {
    const presentations = [
      { module_id: "module-c", rank: "00000003", tab_hidden: true },
    ] as ModulePresentation[];

    expect(visibleModules(MODULES, presentations).map((module) => module.id))
      .toEqual(["module-a", "module-d"]);
  });
});
