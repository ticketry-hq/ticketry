import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return {
    ...actual,
    listModulePresentations: vi.fn(),
    listModules: vi.fn(),
    listProjects: vi.fn(),
    reorderModulePresentation: vi.fn(),
    updateModulePresentation: vi.fn(),
  };
});

import { loadProjects } from "../features/projects";
import type { ModulePresentation } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";
import { dragModule } from "./moduleDragGestures";
import {
  deferred,
  listModules,
  listProjects,
  modules,
  moved,
  project,
  renderAutomaticProject,
  reorderModulePresentation,
  resetModuleReorderHarness,
  rowFor,
  rows,
  sidebarOrder,
  tabStripOrder,
} from "./moduleReorderHarness";

describe("module sidebar reorder acceptance", () => {
  beforeEach(resetModuleReorderHarness);

  it("[overhaul-42] freezes the visible module order on the first sidebar drag", async () => {
    await renderAutomaticProject();
    const settle = deferred<ModulePresentation>();
    reorderModulePresentation.mockReturnValue(settle.promise);

    // Drag the last module above the first. The visible server order is the
    // first-drag baseline.
    dragModule("module-c", "module-a", "near");

    await waitFor(() => expect(reorderModulePresentation).toHaveBeenCalled());
    expect(reorderModulePresentation).toHaveBeenCalledWith("module-c", {
      before_id: null,
      after_id: "module-a",
      initial_order_ids: ["module-a", "module-b", "module-c"],
    });

    // The move appears at once on both reorder-visible surfaces, before the
    // server has answered.
    expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]);
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);
    settle.resolve(moved("module-c"));
  });

  it("[overhaul-43] converges on authoritative project and module data after a drag", async () => {
    await renderAutomaticProject();

    const settle = deferred<ModulePresentation>();
    reorderModulePresentation.mockReturnValue(settle.promise);
    // The server now owns the whole order.
    listModules.mockResolvedValue(modules("module-c", "module-a", "module-b"));

    dragModule("module-c", "module-a", "near");

    // A second gesture cannot start against an order the server has not agreed to.
    await waitFor(() =>
      expect(rows().every((row) => row.getAttribute("draggable") === "false")).toBe(
        true,
      ),
    );

    settle.resolve(moved("module-c"));

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]),
    );
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);
    expect(rows().every((row) => row.getAttribute("draggable") === "true")).toBe(true);
  });

  it("[overhaul-59] keeps module order independent of an older projects read", async () => {
    await renderAutomaticProject();

    // Another consumer has a projects read in flight across the accepted reorder.
    const staleProjects = deferred<ReturnType<typeof project>[]>();
    listProjects.mockReturnValueOnce(staleProjects.promise);
    const staleLoad = loadProjects().catch(() => undefined);
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));

    const settle = deferred<ModulePresentation>();
    reorderModulePresentation.mockReturnValue(settle.promise);
    listModules.mockResolvedValue(modules("module-c", "module-a", "module-b"));

    dragModule("module-c", "module-a", "near");
    await waitFor(() => expect(reorderModulePresentation).toHaveBeenCalled());
    settle.resolve(moved("module-c"));

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]),
    );
    staleProjects.resolve([project(false)]);
    await staleLoad;

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]),
    );
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);
  });

  it("[overhaul-44] restores the previous order when a reorder is refused, and retries", async () => {
    await renderAutomaticProject();

    reorderModulePresentation.mockRejectedValueOnce(new Error("nope"));
    dragModule("module-c", "module-a", "near");

    // The optimistic order is shown first, then withdrawn with an explanation.
    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-a", "module-b", "module-c"]),
    );
    expect(tabStripOrder()).toEqual(["A", "B", "C"]);
    expect(
      useClientStore
        .getState()
        .toasts.some(
          (toast) =>
            toast.kind === "error" && toast.message.includes("could not be reordered"),
        ),
    ).toBe(true);

    // Retry: the same gesture is accepted and the authoritative order arrives.
    reorderModulePresentation.mockResolvedValue(moved("module-c"));
    listModules.mockResolvedValue(modules("module-c", "module-a", "module-b"));

    dragModule("module-c", "module-a", "near");

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]),
    );
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);
  });

  it("[overhaul-45] writes nothing for a cancelled or no-op module drop", async () => {
    await renderAutomaticProject();

    // Cancelled: the pointer left the row before release.
    const { target } = dragModule("module-c", "module-a", "near", { drop: false });
    expect(screen.getByTestId("module-drop-seam")).toHaveAttribute(
      "data-drop-intent",
      "near",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("module-drop-seam")).toBeNull();

    // No-op: dropped back onto the edge it already occupies.
    dragModule("module-b", "module-a", "far");
    dragModule("module-a", "module-a", "far");

    expect(reorderModulePresentation).not.toHaveBeenCalled();
    expect(sidebarOrder()).toEqual(["module-a", "module-b", "module-c"]);

    // A drop must not select the module it landed on, but an ordinary click must.
    dragModule("module-c", "module-a", "near");
    fireEvent.click(target);
    expect(useClientStore.getState().modulesCursorId).toBeNull();

    await waitFor(() =>
      expect(reorderModulePresentation).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(rowFor("module-b"));
    expect(useClientStore.getState().modulesCursorId).toBe("module-b");
  });
});
