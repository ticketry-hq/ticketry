import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return {
    ...actual,
    listModules: vi.fn(),
    listProjects: vi.fn(),
    reorderWorkItem: vi.fn(),
  };
});

import { useAgentStatusStore } from "../features/agents/status";
import type { WorkItem } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";
import {
  dataTransfer,
  dragEvent,
  dragTab,
  dragTabAboveStrip,
} from "./moduleDragGestures";
import {
  backlogGroupOrder,
  deferred,
  listModules,
  listProjects,
  modules,
  moved,
  project,
  renderAutomaticProject,
  reorderWorkItem,
  resetModuleReorderHarness,
  rows,
  sidebarOrder,
  tabBadges,
  tabFor,
  tabStripOrder,
  tabs,
} from "./moduleReorderHarness";

describe("module tab strip reorder acceptance", () => {
  beforeEach(resetModuleReorderHarness);

  it("[overhaul-51] places a module by the tab half it is dropped on, and every surface follows", async () => {
    await renderAutomaticProject();

    const settle = deferred<WorkItem>();
    reorderWorkItem.mockReturnValue(settle.promise);
    // The server has taken the project manual and now owns the whole order.
    listProjects.mockResolvedValue([project(true)]);
    listModules.mockResolvedValue(modules("module-c", "module-a", "module-b"));

    // Before release, the strip promises the resolved edge — and only the strip:
    // a gesture here must not make the sidebar advertise a drop it is not taking.
    dragTab("module-c", "module-a", "near", { drop: false });
    expect(screen.getByTestId("module-tab-drop-seam")).toHaveAttribute(
      "data-drop-intent",
      "near",
    );
    expect(screen.queryByTestId("module-drop-seam")).toBeNull();

    // The left half of a tab means "before it", and the baseline is the
    // activity-sorted order the user could actually see.
    dragTab("module-c", "module-a", "near");

    await waitFor(() => expect(reorderWorkItem).toHaveBeenCalled());
    expect(reorderWorkItem).toHaveBeenCalledWith("module-c", {
      before_id: null,
      after_id: "module-a",
      initial_order_ids: ["module-a", "module-b", "module-c"],
    });

    // One cached order: the strip that was dragged, the sidebar, and a
    // read-only consumer all move at once, before the server has answered.
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);
    expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]);
    expect(backlogGroupOrder()).toEqual(["C", "A", "B"]);

    // A reorder in flight disables dragging everywhere, not only on the surface
    // that started it.
    expect(tabs().every((tab) => tab.getAttribute("draggable") === "false")).toBe(
      true,
    );
    expect(rows().every((row) => row.getAttribute("draggable") === "false")).toBe(
      true,
    );

    settle.resolve(moved("module-c"));
    await waitFor(() =>
      expect(tabs().every((tab) => tab.getAttribute("draggable") === "true")).toBe(
        true,
      ),
    );
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);

    // The right half of the same tab means "after it".
    listModules.mockResolvedValue(modules("module-a", "module-c", "module-b"));
    dragTab("module-c", "module-a", "far");

    await waitFor(() => expect(reorderWorkItem).toHaveBeenCalledTimes(2));
    expect(reorderWorkItem).toHaveBeenLastCalledWith("module-c", {
      before_id: "module-a",
      after_id: "module-b",
      initial_order_ids: ["module-c", "module-a", "module-b"],
    });
    expect(tabStripOrder()).toEqual(["A", "C", "B"]);
    expect(sidebarOrder()).toEqual(["module-a", "module-c", "module-b"]);

    // A tab drag that drifts above the strip is still pointing at a seam: the
    // horizontal position is what places a tab, so the vertical one must not
    // withdraw the promise or lose the release (#365).
    await waitFor(() =>
      expect(tabs().every((tab) => tab.getAttribute("draggable") === "true")).toBe(
        true,
      ),
    );
    listModules.mockResolvedValue(modules("module-b", "module-a", "module-c"));

    dragTabAboveStrip("module-b", "module-a", "near", { drop: false });
    expect(screen.getByTestId("module-tab-drop-seam")).toHaveAttribute(
      "data-drop-intent",
      "near",
    );
    expect(tabFor("module-a").querySelector("[data-testid='module-tab-drop-seam']"))
      .not.toBeNull();

    dragTabAboveStrip("module-b", "module-a", "near");

    await waitFor(() => expect(reorderWorkItem).toHaveBeenCalledTimes(3));
    expect(reorderWorkItem).toHaveBeenLastCalledWith("module-b", {
      before_id: null,
      after_id: "module-a",
      initial_order_ids: ["module-a", "module-c", "module-b"],
    });
    expect(tabStripOrder()).toEqual(["B", "A", "C"]);
    expect(sidebarOrder()).toEqual(["module-b", "module-a", "module-c"]);
  });

  it("[overhaul-52] keeps tab navigation and the fixed add-module button intact across a reorder", async () => {
    const scrolledInto: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolledInto.push(this);
    });
    const selectModule = vi.fn(async () => {});

    await renderAutomaticProject();
    useClientStore.setState({ selectedModuleId: "module-b", selectModule });
    useAgentStatusStore.setState({
      runs: {
        "run-1": { module_id: "module-c", state: "working" },
      } as unknown as ReturnType<typeof useAgentStatusStore.getState>["runs"],
    });
    await waitFor(() => expect(tabBadges("module-c")).toHaveLength(1));

    const strip = screen.getByRole("tablist");
    const addButton = screen.getByLabelText("Add module");

    // Creation is pinned to the left edge and is not one of the project's
    // Modules: it cannot be picked up, and it cannot receive one.
    expect(strip.firstElementChild).toBe(addButton);
    expect(addButton.getAttribute("draggable")).toBeNull();

    const transfer = dataTransfer();
    dragEvent(tabFor("module-c"), "dragstart", transfer);
    dragEvent(addButton, "dragover", transfer, { clientX: 4 });
    expect(screen.queryByTestId("module-tab-drop-seam")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });

    // Selecting a Module scrolled its tab into view once. Forget that call: the
    // reorder below has to produce a new one of its own.
    await waitFor(() => expect(scrolledInto).not.toHaveLength(0));
    scrolledInto.length = 0;

    dragTab("module-c", "module-a", "near");
    await waitFor(() => expect(tabStripOrder()).toEqual(["C", "A", "B"]));

    // Reordering moves tabs, not what they mean: the selected tab, its
    // lifecycle badge, and the scrolled-to element still belong to the same
    // Modules, and the add button has not drifted along with the list.
    expect(tabFor("module-b").getAttribute("aria-selected")).toBe("true");
    expect(tabFor("module-c").getAttribute("aria-selected")).toBe("false");
    expect(tabBadges("module-c")).toHaveLength(1);
    expect(tabBadges("module-a")).toEqual([]);
    expect(strip.firstElementChild).toBe(addButton);

    // The selected tab kept its id but changed position, so it must be scrolled
    // back into the strip's horizontal viewport (#369).
    await waitFor(() => expect(scrolledInto).toContain(tabFor("module-b")));

    // The click a browser emits on the tab a drag finished over must not change
    // the selected Module — but the next, deliberate click must.
    fireEvent.click(tabFor("module-a"));
    expect(selectModule).not.toHaveBeenCalled();

    fireEvent.click(tabFor("module-a"));
    expect(selectModule).toHaveBeenCalledWith("module-a");
  });
});
