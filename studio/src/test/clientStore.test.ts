import { beforeEach, describe, expect, it, vi } from "vitest";

describe("clientStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("migrates legacy collapsed state names to live ids once", async () => {
    localStorage.setItem(
      "studio.collapsedStates:v1",
      JSON.stringify(["Todo", "Deleted state"]),
    );
    const { useClientStore } = await import("../state/clientStore");

    useClientStore.getState().migrateCollapsedStateNames([
      { id: "state-todo", name: "Todo" },
      { id: "state-done", name: "Done" },
    ]);

    expect(useClientStore.getState().collapsedStateIds).toEqual(
      new Set(["state-todo"]),
    );
    expect(localStorage.getItem("studio.collapsedStates:v2")).toBe(
      '["state-todo"]',
    );
    expect(localStorage.getItem("studio.collapsedStates:v1")).toBeNull();

    useClientStore.getState().migrateCollapsedStateNames([
      { id: "different-id", name: "Todo" },
    ]);
    expect(useClientStore.getState().collapsedStateIds).toEqual(
      new Set(["state-todo"]),
    );
  });

  it("keeps expansion keyed by module and cursor intent keyed by id", async () => {
    const { resolveCursorId, useClientStore } = await import(
      "../state/clientStore"
    );
    useClientStore.setState({
      expandedIdsByModule: { first: ["remembered"] },
      modulesCursorId: "removed",
    });

    useClientStore.getState().toggleExpanded("second", "branch");
    expect(useClientStore.getState().expandedIdsByModule).toEqual({
      first: ["remembered"],
      second: ["branch"],
    });
    expect(JSON.parse(localStorage.getItem("studio.expandedSubtasks:v1")!))
      .toEqual({ first: ["remembered"], second: ["branch"] });

    expect(resolveCursorId("removed", ["first", "second"])).toBe("first");
    useClientStore.getState().moveModulesCursor(1, ["first", "second"]);
    expect(useClientStore.getState().modulesCursorId).toBe("first");
  });

  it("migrates and updates remembered task selections by module", async () => {
    localStorage.setItem(
      "studio.coding.selectedTaskByModule",
      JSON.stringify({ legacy: "old-story" }),
    );
    const { useClientStore } = await import("../state/clientStore");

    useClientStore.setState({ selectedModuleId: "current" });
    useClientStore.getState().selectTask("new-story");

    expect(
      JSON.parse(localStorage.getItem("studio.selectedTaskByModule:v1")!),
    ).toEqual({ legacy: "old-story", current: "new-story" });
    expect(
      localStorage.getItem("studio.coding.selectedTaskByModule"),
    ).toBeNull();
  });

  it("does not retain the deleted active bindings field", async () => {
    const { useClientStore } = await import("../state/clientStore");
    const state = useClientStore.getState() as unknown as Record<string, unknown>;

    expect(state).not.toHaveProperty("activeBindings");
    expect(state.bindingsStack).toEqual([expect.any(Array)]);
  });
});
