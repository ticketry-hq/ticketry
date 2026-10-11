import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { setStorySprintFilterIntent } from "../features/work-items";
import { useClientStore } from "../state/clientStore";
import { dataTransfer, dragEvent } from "./moduleDragGestures";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import ToastHost from "../app/shell/ToastHost";
import { projectOpenFixture } from "./projectOpenFixture";
import { loadModules, useStudioStore } from "../features/projects";
import { DialogHost } from "../app/shell/DialogHost";

function managerRow(id: string) {
  return document.querySelector<HTMLElement>(`[data-module-manager-row="${id}"]`)!;
}

function dragManager(sourceId: string, targetId: string) {
  const source = managerRow(sourceId), target = managerRow(targetId);
  Object.defineProperty(target, "getBoundingClientRect", { configurable: true,
    value: () => ({ top: 0, bottom: 40, height: 40, left: 0, right: 400, width: 400 }) });
  const transfer = dataTransfer();
  dragEvent(source, "dragstart", transfer);
  dragEvent(target, "dragover", transfer, { clientY: 2 });
  dragEvent(target, "drop", transfer, { clientY: 2 });
}

it("[overhaul-650] reorders Open rows through canonical project presentation order and shares pending state with tabs", async () => {
  const boundary = storySprintModuleBoundary();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const writes: unknown[] = [];
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) !== "ReorderWorkTrackerModulePresentation") return boundary.execute(document, variables);
    writes.push(variables);
    await pending;
    const order = ["module-3", "module-1", "module-2"];
    boundary.modules.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    boundary.presentations.forEach((row, index) => { boundary.presentations[index] = { ...row, rank: String(order.indexOf(row.module_id)).padStart(8, "0") }; });
    return { reorder_module_presentation: { __typename: "WorktrackerModulepresentation",
      module_id: "module-3", rank: "00000000", tab_hidden: false } } as never;
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  act(() => setStorySprintFilterIntent("project-1", { mode: "all" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  await waitFor(() => expect(managerRow("module-3")).toHaveAttribute("draggable", "true"));
  expect(managerRow("module-2")).toHaveAttribute("draggable", "false");
  dragManager("module-3", "module-1");
  await waitFor(() => expect(writes).toEqual([{ moduleId: "module-3", beforeId: null,
    afterId: "module-1", initialOrderIds: ["module-1", "module-2", "module-3"] }]));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  expect(within(manager).getAllByRole("button", { name: /^Inspect / }).map((row) => row.textContent)).toEqual([
    expect.stringContaining("0.2.0"), expect.stringContaining("Roadmap"), expect.stringContaining("bugs"),
  ]);
  expect(screen.getAllByRole("tab").filter((tab) => tab.dataset.moduleId).map((tab) => tab.dataset.moduleId)).toEqual(["module-3", "module-1"]);
  expect(managerRow("module-1")).toHaveAttribute("draggable", "false");
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("draggable", "false");
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  await act(async () => { release(); await pending; });
  await waitFor(() => expect(managerRow("module-1")).toHaveAttribute("draggable", "true"));
  expect(boundary.calls.filter(({ operation }) => /^(Update|Reorder)/.test(operation))).toEqual([]);
});

it("[overhaul-651] prevents restricted, hidden and archived reorder and cancels an accepted drag when sprint scope changes", async () => {
  const boundary = storySprintModuleBoundary();
  const writes: unknown[] = [];
  let releaseMembership!: () => void;
  const membership = new Promise<void>((resolve) => { releaseMembership = resolve; });
  const retired = { ...boundary.modules[0]!, id: "retired", name: "Retired", is_archived: true };
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "ProjectStorySprintIndex") await membership;
    if (operation === "ReorderWorkTrackerModulePresentation") { writes.push(variables); throw new Error("Forbidden drag"); }
    if (operation === "ModuleManagerArchivedModules") {
      const nodes = projectOpenFixture({ id: "project-1", name: "Project", slug: "PROJECT", description: "" }, [retired]).data.modules.nodes;
      return { modules: { __typename: "WorktrackerIssueConnection", nodes: nodes.map((row) => ({ ...row, state_revision: 1 })),
        pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: 1 } } } as never;
    }
    return boundary.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  expect(within(manager).getByText(/Loading module eligibility/)).toBeVisible();
  ["module-1", "module-2", "module-3"].forEach((id) => expect(managerRow(id)).toHaveAttribute("draggable", "false"));
  dragManager("module-3", "module-1");
  expect(writes).toEqual([]);
  await act(async () => { releaseMembership(); await membership; });
  await waitFor(() => expect(within(manager).getByRole("region", { name: "Not in sprint" })).toHaveTextContent("0.2.0"));
  ["module-1", "module-2", "module-3"].forEach((id) => expect(managerRow(id)).toHaveAttribute("draggable", "false"));
  act(() => setStorySprintFilterIntent("project-1", { mode: "all" }));
  await waitFor(() => expect(managerRow("module-3")).toHaveAttribute("draggable", "true"));
  const search = within(manager).getByRole("searchbox", { name: "Search modules" });
  fireEvent.change(search, { target: { value: "Roadmap" } });
  expect(managerRow("module-1")).toHaveAttribute("draggable", "false");
  fireEvent.change(search, { target: { value: "" } });
  expect(managerRow("module-3")).toHaveAttribute("draggable", "true");
  fireEvent.click(within(managerRow("module-1")).getByRole("button", { name: "Rename Roadmap" }));
  expect(managerRow("module-3")).toHaveAttribute("draggable", "false");
  fireEvent.click(within(manager).getByRole("button", { name: "Cancel module rename" }));
  expect(managerRow("module-3")).toHaveAttribute("draggable", "true");
  fireEvent.click(within(manager).getByRole("button", { name: /^Archived .*modules$/ }));
  expect(await within(manager).findByRole("button", { name: "Inspect Retired" })).toBeVisible();
  expect(managerRow("retired")).toHaveAttribute("draggable", "false");
  expect(within(managerRow("retired")).queryByRole("button", { name: /^(Open|Close|Restore|Rename|Archive) Retired/ })).toBeNull();
  dragManager("retired", "module-1");
  dragManager("module-2", "module-1");
  expect(writes).toEqual([]);
  const source = managerRow("module-3"), target = managerRow("module-1"), transfer = dataTransfer();
  dragEvent(source, "dragstart", transfer);
  dragEvent(target, "dragover", transfer);
  expect(screen.getByTestId("module-manager-drop-seam")).toBeVisible();
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-24" }));
  expect(screen.queryByTestId("module-manager-drop-seam")).toBeNull();
  dragEvent(target, "drop", transfer);
  dragEvent(source, "dragend", transfer);
  expect(writes).toEqual([]);
});

it("[overhaul-652] rolls back a refused reorder and leaves focused contextual row actions and a retryable drag", async () => {
  const boundary = storySprintModuleBoundary();
  let refuse = true;
  let writes = 0;
  boundary.mount({ shell: true, selectedTaskId: null, children: <ToastHost />, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) !== "ReorderWorkTrackerModulePresentation") return boundary.execute(document, variables);
    writes += 1;
    if (refuse) throw new Error("Project order is locked");
    const order = ["module-3", "module-1", "module-2"];
    boundary.modules.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    boundary.presentations.forEach((row, index) => { boundary.presentations[index] = { ...row, rank: String(order.indexOf(row.module_id)).padStart(8, "0") }; });
    return { reorder_module_presentation: { __typename: "WorktrackerModulepresentation",
      module_id: "module-3", rank: "00000000", tab_hidden: false } } as never;
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  act(() => setStorySprintFilterIntent("project-1", { mode: "all" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  await waitFor(() => expect(managerRow("module-3")).toHaveAttribute("draggable", "true"));
  const close = within(managerRow("module-1")).getByRole("button", { name: "Close Roadmap tab" });
  close.focus(); expect(close).toHaveFocus();
  expect(close.className).toContain("focus-visible:outline");
  dragManager("module-3", "module-1");
  expect((await screen.findByText("Modules could not be reordered: Project order is locked")).closest('[role="alert"]')).toBeVisible();
  await waitFor(() => expect(managerRow("module-3")).toHaveAttribute("draggable", "true"));
  expect(screen.getAllByRole("tab").filter((tab) => tab.dataset.moduleId).map((tab) => tab.dataset.moduleId)).toEqual(["module-1", "module-3"]);
  expect(within(screen.getByRole("region", { name: "Open" })).getAllByRole("button", { name: /^Inspect / }).map((row) => row.getAttribute("aria-label"))).toEqual(["Inspect Roadmap", "Inspect 0.2.0"]);
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  refuse = false;
  dragManager("module-3", "module-1");
  await waitFor(() => expect(writes).toBe(2));
  await waitFor(() => expect(managerRow("module-3")).toHaveAttribute("draggable", "true"));
  expect(screen.getAllByRole("tab").filter((tab) => tab.dataset.moduleId).map((tab) => tab.dataset.moduleId)).toEqual(["module-3", "module-1"]);
});

it("[overhaul-653] cancels manager drag across project visits and while archive confirmation owns the action", async () => {
  const boundary = storySprintModuleBoundary();
  const writes: unknown[] = [];
  boundary.mount({ shell: true, selectedTaskId: null, children: <DialogHost />, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "WorkTrackerProjectOpen" && (variables as { projectId: string }).projectId === "project-2") {
      return projectOpenFixture({ id: "project-2", name: "Other project", slug: "OTHER", description: "" }, []).data as never;
    }
    if (operation === "ReorderWorkTrackerModulePresentation") {
      writes.push(variables);
      return { reorder_module_presentation: { __typename: "WorktrackerModulepresentation",
        module_id: "module-3", rank: "00000000", tab_hidden: false } } as never;
    }
    return boundary.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  act(() => {
    setStorySprintFilterIntent("project-1", { mode: "all" });
    setStorySprintFilterIntent("project-2", { mode: "all" });
  });
  await act(async () => { await loadModules("project-2"); });
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  await waitFor(() => expect(managerRow("module-3")).toHaveAttribute("draggable", "true"));
  const transfer = dataTransfer();
  dragEvent(managerRow("module-3"), "dragstart", transfer);
  dragEvent(managerRow("module-1"), "dragover", transfer);
  expect(screen.getByTestId("module-manager-drop-seam")).toBeVisible();
  await act(async () => { await useStudioStore.getState().selectProject("project-2"); });
  await act(async () => { await useStudioStore.getState().selectProject("project-1"); });
  expect(screen.queryByTestId("module-manager-drop-seam")).toBeNull();
  dragEvent(managerRow("module-1"), "drop", transfer);
  expect(writes).toEqual([]);
  const archiveTransfer = dataTransfer();
  dragEvent(managerRow("module-3"), "dragstart", archiveTransfer);
  dragEvent(managerRow("module-1"), "dragover", archiveTransfer);
  expect(screen.getByTestId("module-manager-drop-seam")).toBeVisible();
  fireEvent.click(within(managerRow("module-1")).getByRole("button", { name: "Archive Roadmap" }));
  const confirmation = await screen.findByRole("dialog");
  expect(managerRow("module-3")).toHaveAttribute("draggable", "false");
  expect(screen.queryByTestId("module-manager-drop-seam")).toBeNull();
  dragEvent(managerRow("module-1"), "drop", archiveTransfer);
  expect(writes).toEqual([]);
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(managerRow("module-3")).toHaveAttribute("draggable", "true"));
  expect(boundary.calls.filter(({ operation }) => /^ArchiveWorkTracker/.test(operation))).toEqual([]);
});
