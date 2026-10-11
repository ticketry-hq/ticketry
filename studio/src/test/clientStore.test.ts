import { beforeEach, describe, expect, it, vi } from "vitest";

describe("clientStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("ignores retired sidebar visibility values and prevents the legacy setter reopening a pane", async () => {
    localStorage.setItem("studio.sidebarVisible:v1", "false");
    localStorage.setItem("studio.sidebarVisible:v2", "true");
    const { useClientStore } = await import("../state/clientStore");

    expect(useClientStore.getState().sidebarVisible).toBe(false);
    useClientStore.getState().setSidebarVisible(true);
    expect(useClientStore.getState().sidebarVisible).toBe(false);
    useClientStore.getState().focusLeft();
    expect(useClientStore.getState().focusedPane).toBe("tasks");
    expect(localStorage.getItem("studio.sidebarVisible:v2")).toBe("true");
    expect(localStorage.getItem("studio.sidebarVisible:v1")).toBe("false");
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

  it.each([{ layout: [18, 32, 50] }, { layout: [12, 18, 32, 50] }])("restores legacy layout $layout as the same Stories/workspace proportion", async ({ layout }) => {
    localStorage.setItem("studio.panelLayout:v1", JSON.stringify(layout));
    const { useClientStore } = await import("../state/clientStore");
    expect(useClientStore.getState().panelLayout?.[0]).toBeCloseTo(39.0243902439);
    expect(useClientStore.getState().panelLayout?.[1]).toBeCloseTo(60.9756097561);
    expect(useClientStore.getState().panelLayout).toHaveLength(2);
  });

  it("keeps expansion keyed by module without restoring a retired module cursor", async () => {
    const { useClientStore } = await import(
      "../state/clientStore"
    );
    useClientStore.setState({
      expandedIdsByModule: { first: ["remembered"] },
    });

    useClientStore.getState().toggleExpanded("second", "branch");
    expect(useClientStore.getState().expandedIdsByModule).toEqual({
      first: ["remembered"],
      second: ["branch"],
    });
    expect(JSON.parse(localStorage.getItem("studio.expandedSubtasks:v1")!))
      .toEqual({ first: ["remembered"], second: ["branch"] });

    useClientStore.getState().moveModulesCursor(1, ["first", "second"]);
    expect(useClientStore.getState().modulesCursorId).toBeNull();
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

  it("does not retain parallel keybinding state", async () => {
    const { useClientStore } = await import("../state/clientStore");
    const state = useClientStore.getState() as unknown as Record<string, unknown>;

    expect(state).not.toHaveProperty("activeBindings");
    expect(state).not.toHaveProperty("bindingsStack");
  });
});
