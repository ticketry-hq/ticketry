import { expect, it } from "vitest";
import type { ModuleTabEntry } from "../module-tabs";
import { projectModuleManagerGroups } from "./index";

const entry = (id: string, status: ModuleTabEntry["status"]): ModuleTabEntry => ({
  module: { id, name: id, key: "CODING-" + id, sequence_id: 1, project_id: "project", is_archived: status === "archived", issue_type: "module" },
  status, sprintEligible: status === "not-in-sprint" ? false : true,
});

it("search reveals matches across collapsed groups by name, key and local folder without changing collapse preferences", () => {
  const entries = [entry("active", "open"), entry("closed", "hidden"), entry("outside", "not-in-sprint"), entry("old", "archived")];
  const collapsed = { hidden: true, archived: true };
  const groups = projectModuleManagerGroups(entries, "CoDiNg", {}, collapsed);
  expect(groups.map(({ id, total, entries: rows, expanded }) => [id, total, rows.map(({ module }) => module.id), expanded])).toEqual([
    ["open", 1, ["active"], true], ["hidden", 1, ["closed"], true],
    ["not-in-sprint", 1, ["outside"], true], ["archived", 1, ["old"], true],
  ]);
  expect(projectModuleManagerGroups(entries, "LEGACY", { old: "/work/legacy" }, collapsed).find(({ id }) => id === "archived")?.entries.map(({ module }) => module.id)).toEqual(["old"]);
  expect(projectModuleManagerGroups(entries, "CLOSED", {}, collapsed).find(({ id }) => id === "hidden")?.entries.map(({ module }) => module.id)).toEqual(["closed"]);
  expect(projectModuleManagerGroups(entries, "", {}, collapsed).map(({ expanded }) => expanded)).toEqual([true, false, true, false]);
  expect(collapsed).toEqual({ hidden: true, archived: true });
});
