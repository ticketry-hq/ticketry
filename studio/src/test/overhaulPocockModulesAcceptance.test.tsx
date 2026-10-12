import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";
import { setStorySprintFilterIntent } from "../features/work-items";
import { useClientStore } from "../state/clientStore";
import { rememberTaskSelection } from "../state/persistence";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { dragTab } from "./moduleDragGestures";
import { DialogHost } from "../app/shell/DialogHost";

function tabNames() {
  return screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id"))
    .map((tab) => tab.getAttribute("aria-label"));
}

it("[overhaul-573] Pocock keeps saved module order, hidden tabs, drag and number navigation under retained sprint intent", async () => {
  const f = editionAcceptanceFixture();
  // Persisted order differs from creation order, and bugs remains manually hidden.
  f.presentations[0] = { ...f.presentations[0]!, rank: "00000002" };
  f.presentations[2] = { ...f.presentations[2]!, rank: "00000000" };
  setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-24" });
  f.mount();
  await waitFor(() => expect(tabNames()).toEqual(["0.2.0", "Roadmap"]));
  expect(screen.getByRole("button", { name: "Hide Roadmap tab" })).toBeEnabled();
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("draggable", "true");
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-empty" }));
  expect(tabNames()).toEqual(["0.2.0", "Roadmap"]);
  fireEvent.keyDown(window, { key: "1", code: "Digit1", metaKey: true });
  await waitFor(() => expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true"));
  expect(await screen.findByText("Release next story")).toBeVisible();
  fireEvent.keyDown(window, { key: "2", code: "Digit2", metaKey: true });
  await waitFor(() => expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true"));
  expect(f.presentations.find((row) => row.module_id === "module-2")!.tab_hidden).toBe(true);
  dragTab("module-1", "module-3", "near", { drop: false });
  expect(screen.getByTestId("module-tab-drop-seam")).toHaveAttribute("data-drop-intent", "near");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(f.calls.filter(({ operation }) => operation === "UpdateWorkTrackerModulePresentation")).toEqual([]);
});

it("[overhaul-575] Pocock recovers hidden tabs through explicit manager Restore and Open, then ordinary picker actions", async () => {
  const f = editionAcceptanceFixture();
  f.presentations.forEach((row, index) => { f.presentations[index] = { ...row, tab_hidden: true }; });
  setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-empty" });
  f.mount({ selectedModuleId: null, selectedTaskId: null });
  expect(await screen.findByTestId("empty-module-workspace")).toBeVisible();
  expect(tabNames()).toEqual([]);
  expect(f.calls.filter(({ operation }) => operation === "UpdateWorkTrackerModulePresentation")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  const manager = await screen.findByRole("region", { name: "Module Manager" });
  expect(manager).toBeVisible();
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect bugs" }));
  const detail = within(manager).getByRole("region", { name: "Module details: bugs" });
  expect(within(detail).getByRole("heading", { name: "bugs" })).toBeVisible();
  expect(within(detail).getByText("Local profile folder")).toBeVisible();
  expect(within(detail).getByText("Agents and lifecycle")).toBeVisible();
  expect(within(detail).queryByText("Sprint membership")).toBeNull();
  expect(within(detail).queryByText(/Sprint 24|Sprint 25|Loading sprint|Sprint membership/)).toBeNull();
  fireEvent.click(within(detail).getByRole("button", { name: "Restore bugs" }));
  await waitFor(() => expect(tabNames()).toEqual(["bugs"]));
  expect(useClientStore.getState().selectedModuleId).toBeNull();
  expect(manager).toBeVisible();
  fireEvent.click(within(detail).getByRole("button", { name: "Open bugs" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  await waitFor(() => expect(screen.getByRole("tab", { name: "bugs" })).toHaveAttribute("aria-selected", "true"));
  expect(await screen.findByText("Bugs current story")).toBeVisible();
  expect(screen.getByText("Bugs next story")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open module picker" }));
  const picker = screen.getByRole("dialog", { name: "Module picker" });
  expect(within(picker).queryByRole("option", { name: "Show all sprints" })).not.toBeInTheDocument();
  fireEvent.click(within(picker).getByRole("option", { name: "Restore 0.2.0 module tab" }));
  await waitFor(() => expect(tabNames()).toEqual(["bugs", "0.2.0"]));
  await waitFor(() => expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true"));
  expect(f.presentations.find((row) => row.module_id === "module-1")!.tab_hidden).toBe(true);
  expect(f.calls.filter(({ operation }) => operation === "UpdateWorkTrackerModulePresentation")).toEqual([
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-2", tabHidden: false } },
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-3", tabHidden: false } },
  ]);
  expect(f.calls.filter(({ operation }) => /^(Create|Update|Delete).*Sprint/.test(operation))).toEqual([]);
});

it("[overhaul-576] Pocock keeps generic unselected and zero-module recovery independent of failed sprint reads", async () => {
  const f = editionAcceptanceFixture();
  setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-empty" });
  const planningReads: string[] = [];
  const view = f.mount({ selectedModuleId: null, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (["StoryActiveSprint", "StorySelectedSprint", "ProjectStorySprintModules", "ProjectStorySprintIndex"].includes(operation)) {
      planningReads.push(operation);
      throw new Error("Retained sprint reads are unavailable");
    }
    return f.execute(document, variables);
  } });
  expect(await screen.findByText("Select a module to view its stories.")).toBeVisible();
  expect(tabNames()).toEqual(["Roadmap", "0.2.0"]);
  expect(useClientStore.getState().selectedModuleId).toBeNull();
  expect(screen.queryByRole("region", { name: "Sprint module recovery" })).not.toBeInTheDocument();
  expect(planningReads).toEqual([]);
  view.unmount();
  // Normal zero-module projects retain their creation action, even with saved intent.
  const empty = editionAcceptanceFixture();
  empty.modules.splice(0);
  empty.presentations.splice(0);
  empty.mount({ selectedModuleId: null, selectedTaskId: null });
  expect(await screen.findByText("No modules yet. Add a module to start planning work.")).toBeVisible();
  expect(screen.getByRole("button", { name: "New module" })).toBeEnabled();
  expect(screen.queryByText("No modules have stories in this sprint.")).not.toBeInTheDocument();
  expect(empty.calls.filter(({ operation }) => operation === "UpdateWorkTrackerModulePresentation")).toEqual([]);
});

it("[overhaul-574] Pocock completes ordinary module restoration when hidden sprint intent changes during a cold read", async () => {
  const f = editionAcceptanceFixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  rememberTaskSelection("module-3", "release-25");
  f.mount({ graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "WorkTrackerModuleOpen"
      && (variables as { moduleId?: string }).moduleId === "module-3") await gate;
    return f.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("tab", { name: "0.2.0" }));
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("module-3"));
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-empty" }));
  await act(async () => release());
  await waitFor(() => expect(useClientStore.getState().selectedTaskId).toBe("release-25"));
  expect(screen.queryByTestId("pane-modules")).toBeNull();
  expect(await screen.findByRole("heading", { name: "Release next story" })).toBeVisible();
  expect(f.calls.filter(({ operation }) => operation === "UpdateWorkTrackerModulePresentation")).toEqual([]);
});

it("[overhaul-841] Pocock Module Manager shows only Open, Hidden and Archived groups and a sprint-free archive confirmation", async () => {
  const f = editionAcceptanceFixture();
  setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-empty" });
  f.mount({ children: <DialogHost /> });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = await screen.findByRole("region", { name: "Module Manager" });
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Inspect Roadmap" })).toBeVisible());
  expect(within(manager).getAllByRole("region").map((region) => region.getAttribute("aria-label")))
    .toEqual(["Open", "Hidden", "Archived"]);
  expect(within(manager).queryByRole("region", { name: "Not in sprint" })).not.toBeInTheDocument();
  expect(manager).not.toHaveTextContent(/sprint/i);
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect Roadmap" }));
  const detail = within(manager).getByRole("region", { name: "Module details: Roadmap" });
  expect(manager).not.toHaveTextContent(/sprint/i);
  fireEvent.click(within(detail).getByRole("button", { name: "Archive Roadmap" }));
  const confirmation = await screen.findByRole("dialog", { name: "Archive Roadmap?" });
  expect(confirmation).toHaveTextContent("archives all descendant Stories and work items on the server");
  expect(confirmation).toHaveTextContent("They leave active lists.");
  expect(confirmation).not.toHaveTextContent(/sprint/i);
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Archive Roadmap?" })).toBeNull());
  expect(within(manager).getByRole("region", { name: "Module details: Roadmap" })).toBeVisible();
  expect(tabNames()).toContain("Roadmap");
  expect(f.calls.filter(({ operation }) => /^(Archive|(Create|Update|Delete).*Sprint)/.test(operation))).toEqual([]);
});
