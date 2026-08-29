import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./legacyApiFixture", async () => {
  const actual = await vi.importActual<typeof import("./legacyApiFixture")>(
    "./legacyApiFixture",
  );
  return {
    ...actual,
    listModules: vi.fn(),
    listProjects: vi.fn(),
    reorderWorkItem: vi.fn(),
  };
});
vi.mock("../features/projects/queries/readTransport", async () => {
  const actual = await vi.importActual<typeof import("../features/projects/queries/readTransport")>(
    "../features/projects/queries/readTransport",
  );
  const api = await import("./legacyApiFixture");
  const { projectOpenFixture } = await import("./projectOpenFixture");
  return {
    ...actual,
    readProjectOpen: async (projectId: string) => {
      const [projects, modules] = await Promise.all([api.listProjects(), api.listModules(projectId)]);
      const project = projects.find((candidate: { id: string }) => candidate.id === projectId) ?? projects[0];
      if (!project) throw new Error(`Project ${projectId} was not found.`);
      return projectOpenFixture(project, modules);
    },
    readOnboardingProjects: vi.fn(),
  };
});
vi.mock("../features/work-items/mutationTransport", async () => {
  const actual = await vi.importActual<typeof import("../features/work-items/mutationTransport")>(
    "../features/work-items/mutationTransport",
  );
  const api = await import("./legacyApiFixture");
  return { ...actual, reorderWorkItem: api.reorderWorkItem };
});

import { loadModules, loadProjects } from "../features/projects";
import type { WorkItem } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";
import { dragModule } from "./moduleDragGestures";
import {
  PROJECT_ID,
  deferred,
  listModules,
  listProjects,
  modules,
  moved,
  project,
  renderAutomaticProject,
  reorderWorkItem,
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
    const settle = deferred<WorkItem>();
    reorderWorkItem.mockReturnValue(settle.promise);

    // Drag the last module above the first. The order the user can see is the
    // activity-sorted one, which only Studio knows — so it must be the baseline.
    dragModule("module-c", "module-a", "near");

    await waitFor(() => expect(reorderWorkItem).toHaveBeenCalled());
    expect(reorderWorkItem).toHaveBeenCalledWith("module-c", {
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

    const settle = deferred<WorkItem>();
    reorderWorkItem.mockReturnValue(settle.promise);
    // The server has taken the project manual and now owns the whole order.
    listProjects.mockResolvedValue([project(true)]);
    listModules.mockResolvedValue(modules("module-c", "module-a", "module-b"));

    dragModule("module-c", "module-a", "near");

    // A second gesture cannot start against an order the server has not agreed to.
    await waitFor(() =>
      expect(rows().every((row) => row.getAttribute("draggable") === "false")).toBe(
        true,
      ),
    );

    settle.resolve(moved("module-c"));

    // Recency still reports a as the most recent module; a manual project must
    // ignore it and keep the server's persisted order.
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]),
    );
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);
    expect(rows().every((row) => row.getAttribute("draggable") === "true")).toBe(true);
  });

  it("keeps an accepted first drag when the project refresh fails", async () => {
    await renderAutomaticProject();

    // The write is accepted — which is what takes the project manual — and the
    // server now returns its persisted rank order. Only the project read fails,
    // so the sole thing left claiming "automatic" is the stale cached project.
    const settle = deferred<WorkItem>();
    reorderWorkItem.mockReturnValue(settle.promise);
    listModules.mockResolvedValue(modules("module-c", "module-a", "module-b"));
    listProjects.mockRejectedValue(new Error("offline"));

    dragModule("module-c", "module-a", "near");
    await waitFor(() => expect(reorderWorkItem).toHaveBeenCalled());
    expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]);

    settle.resolve(moved("module-c"));

    // Recency still names a the most recent module. Layering it back on would
    // restore a, b, c and visually undo the drag the server just accepted.
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(rows().every((row) => row.getAttribute("draggable") === "true")).toBe(true),
    );
    expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]);
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);

    // Once the project list is readable again it is authoritative, and the
    // remembered reorder steps aside for it.
    listProjects.mockResolvedValue([project(false)]);
    listModules.mockResolvedValue(modules("module-c", "module-b", "module-a"));
    await loadModules(PROJECT_ID);

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-a", "module-b", "module-c"]),
    );
  });

  it("[overhaul-59] ignores a projects read that predates an accepted first drag", async () => {
    await renderAutomaticProject();

    // Another consumer starts refreshing projects while the project is still
    // automatic. Keep that old answer in flight across the accepted reorder.
    const staleProjects = deferred<ReturnType<typeof project>[]>();
    listProjects.mockReturnValueOnce(staleProjects.promise);
    const staleLoad = loadProjects().catch(() => undefined);
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));

    const settle = deferred<WorkItem>();
    reorderWorkItem.mockReturnValue(settle.promise);
    listModules.mockResolvedValue(modules("module-c", "module-a", "module-b"));
    listProjects.mockResolvedValue([project(true)]);

    dragModule("module-c", "module-a", "near");
    await waitFor(() => expect(reorderWorkItem).toHaveBeenCalled());
    settle.resolve(moved("module-c"));

    // Settlement must retire the pre-reorder request and start a new mode read.
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(3));
    staleProjects.resolve([project(false)]);
    await staleLoad;

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]),
    );
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);
  });

  it("[overhaul-44] restores the previous order when a reorder is refused, and retries", async () => {
    await renderAutomaticProject();

    reorderWorkItem.mockRejectedValueOnce(new Error("nope"));
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
    reorderWorkItem.mockResolvedValue(moved("module-c"));
    listProjects.mockResolvedValue([project(true)]);
    listModules.mockResolvedValue(modules("module-c", "module-a", "module-b"));

    dragModule("module-c", "module-a", "near");

    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-c", "module-a", "module-b"]),
    );
    expect(tabStripOrder()).toEqual(["C", "A", "B"]);
  });

  it("[overhaul-168] refreshes stale neighbors and completes the same module drag", async () => {
    await renderAutomaticProject();

    reorderWorkItem
      .mockRejectedValueOnce(
        new Error("before/after are not ordered neighbors."),
      )
      .mockResolvedValue(moved("module-c"));
    listProjects.mockResolvedValue([project(true)]);
    // The rejected write proves the visible a, b, c order is stale. The first
    // refresh reveals b, c, a; after the recomputed write the server owns b, a, c.
    listModules
      .mockResolvedValueOnce(modules("module-b", "module-c", "module-a"))
      .mockResolvedValue(modules("module-b", "module-a", "module-c"));

    dragModule("module-c", "module-a", "far");

    await waitFor(() => expect(reorderWorkItem).toHaveBeenCalledTimes(2));
    expect(reorderWorkItem).toHaveBeenNthCalledWith(1, "module-c", {
      before_id: "module-a",
      after_id: "module-b",
      initial_order_ids: ["module-a", "module-b", "module-c"],
    });
    expect(reorderWorkItem).toHaveBeenNthCalledWith(2, "module-c", {
      before_id: "module-a",
      after_id: null,
      initial_order_ids: ["module-b", "module-c", "module-a"],
    });
    await waitFor(() =>
      expect(sidebarOrder()).toEqual(["module-b", "module-a", "module-c"]),
    );
    expect(tabStripOrder()).toEqual(["B", "A", "C"]);
    expect(
      useClientStore
        .getState()
        .toasts.some((toast) => toast.message.includes("could not be reordered")),
    ).toBe(false);
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

    expect(reorderWorkItem).not.toHaveBeenCalled();
    expect(sidebarOrder()).toEqual(["module-a", "module-b", "module-c"]);

    // A drop must not select the module it landed on, but an ordinary click must.
    dragModule("module-c", "module-a", "near");
    fireEvent.click(target);
    expect(useClientStore.getState().modulesCursorId).toBeNull();

    await waitFor(() => expect(reorderWorkItem).toHaveBeenCalledTimes(1));
    fireEvent.click(rowFor("module-b"));
    expect(useClientStore.getState().modulesCursorId).toBe("module-b");
  });
});
