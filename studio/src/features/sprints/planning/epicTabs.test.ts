import { describe, expect, it } from "vitest";
import { seedEpicTabs, closeEpicTab, stepEpicTab } from "./epicTabs";

describe("epic tabs", () => {
  it("starts with no selected epics, even with sprint work and waiting suggestions", () => {
    expect(seedEpicTabs({ modules: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], workItems: [{ id: "story", moduleId: "b", sprintId: "s", typeName: "Story" }] }, [
      { sprintId: "s", status: "waiting", proposedEpicId: "a", issue: null },
      { sprintId: "s", status: "accepted", proposedEpicId: "c", issue: null },
    ], "s")).toEqual({ epicTabs: [], activeEpicId: null });
  });
});

it("closing active selects right, then left, then nothing; stepping wraps", () => {
 const visit = { epicTabs: ["a", "b", "c"], activeEpicId: "b" };
 expect(closeEpicTab(visit, "b")).toEqual({ epicTabs: ["a", "c"], activeEpicId: "c" });
 expect(closeEpicTab(visit, "c")).toEqual({ epicTabs: ["a", "b"], activeEpicId: "b" });
 expect(closeEpicTab({ epicTabs: ["a", "b"], activeEpicId: "b" }, "b")).toEqual({ epicTabs: ["a"], activeEpicId: "a" });
 expect(closeEpicTab({ epicTabs: ["a"], activeEpicId: "a" }, "a")).toEqual({ epicTabs: [], activeEpicId: null });
 expect(stepEpicTab({ epicTabs: ["a", "b"], activeEpicId: "b" }, 1).activeEpicId).toBe("a");
 expect(stepEpicTab({ epicTabs: ["a", "b"], activeEpicId: "a" }, -1).activeEpicId).toBe("b");
 expect(stepEpicTab({ epicTabs: [], activeEpicId: null }, 1)).toEqual({ epicTabs: [], activeEpicId: null });
});
