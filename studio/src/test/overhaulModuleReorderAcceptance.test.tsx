import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { ModulesPane } from "../app/shell/sidebar/modules/ModulesPane";
import { registerModuleRecencyProvider } from "../features/projects";
import { useStudioStore } from "../features/projects/store";
import * as api from "../shared/api/client";
import { queryClient } from "../shared/query/queryClient";
import type { Module, Project, WorkItem } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";

const listModules = api.listModules as ReturnType<typeof vi.fn>;
const listProjects = api.listProjects as ReturnType<typeof vi.fn>;
const reorderWorkItem = api.reorderWorkItem as ReturnType<typeof vi.fn>;

const PROJECT_ID = "project-1";

function modules(...ids: string[]): Module[] {
  return ids.map((id, index) => ({
    id,
    name: id.replace("module-", "").toUpperCase(),
    project_id: PROJECT_ID,
    key: id.toUpperCase(),
    sequence_id: ids.length - index,
    is_archived: false,
    issue_type: "module",
  })) as unknown as Module[];
}

function project(manual_module_order: boolean): Project {
  return {
    id: PROJECT_ID,
    name: "Project",
    slug: "PRJ",
    description: "",
    manual_module_order,
  } as Project;
}

/** Both reorder-visible surfaces at once: they read one cached order. */
function ModuleSurfaces() {
  return (
    <QueryClientProvider client={queryClient}>
      <ModulesPane />
      <ModuleTabStrip />
    </QueryClientProvider>
  );
}

function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("li[data-module-id]"),
  );
}

function sidebarOrder(): string[] {
  return rows().map((row) => row.dataset.moduleId ?? "");
}

function rowFor(moduleId: string): HTMLElement {
  return rows().find((row) => row.dataset.moduleId === moduleId)!;
}

function tabStripOrder(): string[] {
  return screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label") ?? "");
}

function dataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    get types() {
      return [...values.keys()];
    },
    clearData: (type?: string) => (type ? values.delete(type) : values.clear()),
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
  } as unknown as DataTransfer;
}

function dragEvent(
  target: Element,
  type: string,
  transfer: DataTransfer,
  clientY = 0,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
}

const ROW_HEIGHT = 20;

/** Give the rendered rows a real vertical layout so midpoints can resolve. */
function layoutRows(): Map<string, HTMLElement> {
  const byId = new Map<string, HTMLElement>();
  rows().forEach((row, index) => {
    const top = index * ROW_HEIGHT;
    Object.defineProperty(row, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top,
        bottom: top + ROW_HEIGHT,
        height: ROW_HEIGHT,
        left: 0,
        right: 200,
        width: 200,
      }),
    });
    byId.set(row.dataset.moduleId ?? "", row);
  });
  return byId;
}

/** Drag one sidebar module onto the near (top) or far (bottom) half of another. */
function dragModule(
  sourceId: string,
  targetId: string,
  edge: "near" | "far",
  { drop = true }: { drop?: boolean } = {},
) {
  const laidOut = layoutRows();
  const source = laidOut.get(sourceId)!;
  const target = laidOut.get(targetId)!;
  const rect = target.getBoundingClientRect();
  const clientY = edge === "near" ? rect.top + 2 : rect.bottom - 2;
  const transfer = dataTransfer();

  dragEvent(source, "dragstart", transfer);
  dragEvent(target, "dragover", transfer, clientY);
  if (drop) dragEvent(target, "drop", transfer, clientY);
  return { source, target, transfer };
}

function moved(id: string): WorkItem {
  return { id, rank: "V" } as unknown as WorkItem;
}

function deferred<T>() {
  let settle!: { resolve: (value: T) => void; reject: (error: Error) => void };
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

/** The recency-sorted order an automatic project actually shows: a, b, c. */
async function renderAutomaticProject(): Promise<void> {
  listModules.mockResolvedValue(modules("module-c", "module-b", "module-a"));
  listProjects.mockResolvedValue([project(false)]);
  registerModuleRecencyProvider(async () => ({
    "module-a": "2026-08-09T12:00:00Z",
    "module-b": "2026-08-09T09:00:00Z",
  }));

  render(<ModuleSurfaces />);
  await waitFor(() =>
    expect(sidebarOrder()).toEqual(["module-a", "module-b", "module-c"]),
  );
}

describe("module reorder acceptance", () => {
  beforeEach(() => {
    queryClient.clear();
    listModules.mockReset();
    listProjects.mockReset();
    reorderWorkItem.mockReset().mockResolvedValue(moved("module-c"));
    registerModuleRecencyProvider(async () => ({}));
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useClientStore.setState({
      selectedModuleId: null,
      modulesCursorId: null,
      toasts: [],
    });
  });

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
