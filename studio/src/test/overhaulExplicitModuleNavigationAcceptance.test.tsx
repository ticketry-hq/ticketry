import { useState } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { useModuleNavigation } from "../features/module-tabs";
import { getStorySprintFilterIntent, setStorySprintFilterIntent } from "../features/work-items";
import { ModalHost } from "../app/modal";
import { useStudioStore } from "../features/projects";
import { useClientStore } from "../state/clientStore";
import { initializeStudioRuntime, studioRuntime } from "../runtime";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { projectOpenFixture } from "./projectOpenFixture";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

/** Feature navigation contract composed into the approved real-shell seam. */
function NavigationActions({ moduleId }: { moduleId: string }) {
  const { restoreModule, openModule, restoreAndSelectModule } = useModuleNavigation();
  const [result, setResult] = useState<boolean | null>(null);
  return <>
    <button onClick={() => void restoreModule(moduleId).then(setResult)}>Explicit Restore</button>
    <button onClick={() => void openModule(moduleId).then(setResult)}>Explicit Open</button>
    <button onClick={() => void restoreAndSelectModule(moduleId).then(setResult)}>Explicit Restore and Open</button>
    <output aria-label="Navigation result">{result === null ? "Waiting" : result ? "Succeeded" : "Unavailable"}</output>
  </>;
}

it("[overhaul-604] restores an excluded hidden module after clearing the filter without selecting it", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.presentations[2] = { ...boundary.presentations[2]!, tab_hidden: true };
  let filterAtWrite: string | null = null;
  boundary.mount({ shell: true, children: <NavigationActions moduleId="module-3" />, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "UpdateWorkTrackerModulePresentation")
      filterAtWrite = getStorySprintFilterIntent("project-1").mode;
    return boundary.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(screen.getByRole("button", { name: "Open module picker" }));
  expect(screen.getByRole("option", { name: "Restore 0.2.0 module tab" })).toHaveTextContent("Clears sprint filter to show all modules");
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Search modules" }), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Explicit Restore" }));
  await waitFor(() => expect(screen.getByLabelText("Navigation result")).toHaveTextContent("Succeeded"));
  expect(filterAtWrite).toBe("all");
  expect(screen.getByRole("tab", { name: "0.2.0" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
  expect(boundary.calls.filter((call) => call.operation === "UpdateWorkTrackerModulePresentation")).toEqual([
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-3", tabHidden: false } },
  ]);
});

it("[overhaul-605] refuses Open for a hidden module and opens an excluded unhidden module without a visibility write", async () => {
  const boundary = storySprintModuleBoundary();
  const view = boundary.mount({ shell: true, children: <NavigationActions moduleId="module-2" /> });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(screen.getByRole("button", { name: "Explicit Open" }));
  await waitFor(() => expect(screen.getByLabelText("Navigation result")).toHaveTextContent("Unavailable"));
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" })).toBeVisible();
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  view.unmount();
  boundary.mount({ shell: true, children: <NavigationActions moduleId="module-3" /> });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(screen.getByRole("button", { name: "Explicit Open" }));
  await waitFor(() => expect(screen.getByLabelText("Navigation result")).toHaveTextContent("Succeeded"));
  expect(screen.getByRole("button", { name: "Sprint: All sprints" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true");
  expect(boundary.calls.filter((call) => call.operation === "UpdateWorkTrackerModulePresentation")).toEqual([]);
});

it("[overhaul-606] reports Open unavailable while folder linking still requires user action", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, unlinked: ["module-1"], selectedModuleId: null, selectedTaskId: null,
    children: <><NavigationActions moduleId="module-1" /><ModalHost /></> });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(screen.getByRole("button", { name: "Explicit Open" }));
  await waitFor(() => expect(screen.getByLabelText("Navigation result")).toHaveTextContent("Unavailable"));
  expect(useClientStore.getState().selectedModuleId).toBeNull();
  expect(await screen.findByRole("dialog", { name: "Module Folder" })).toBeVisible();
});

it("[overhaul-607] ignores restore selection after the sprint filter changes away and back while its write is pending", async () => {
  const boundary = storySprintModuleBoundary();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  boundary.mount({ shell: true, children: <NavigationActions moduleId="module-2" />, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "UpdateWorkTrackerModulePresentation") await gate;
    return boundary.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(screen.getByRole("button", { name: "Explicit Restore and Open" }));
  await screen.findByRole("tab", { name: "bugs" });
  act(() => {
    setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" });
    setStorySprintFilterIntent("project-1", { mode: "active" });
  });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await act(async () => { release(); });
  await waitFor(() => expect(screen.getByLabelText("Navigation result")).toHaveTextContent("Unavailable"));
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
  expect(boundary.presentations.find((row) => row.module_id === "module-2")?.tab_hidden).toBe(false);
});

it("[overhaul-608] ignores restore selection after switching away from and back to the same project", async () => {
  const boundary = storySprintModuleBoundary();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  boundary.mount({ shell: true, children: <NavigationActions moduleId="module-2" />, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "UpdateWorkTrackerModulePresentation") await gate;
    if (documentOperationName(document) === "WorkTrackerProjectOpen" && (variables as { projectId: string }).projectId === "project-2")
      return projectOpenFixture({ id: "project-2", name: "Other project", slug: "OTHER", description: "", manual_module_order: true }, []).data as never;
    return boundary.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(screen.getByRole("button", { name: "Explicit Restore and Open" }));
  await screen.findByRole("tab", { name: "bugs" });
  await act(async () => { await useStudioStore.getState().selectProject("project-2"); });
  await act(async () => { await useStudioStore.getState().selectProject("project-1"); });
  await waitFor(() => expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true"));
  await act(async () => { release(); });
  await waitFor(() => expect(screen.getByLabelText("Navigation result")).toHaveTextContent("Unavailable"));
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
});

it("[overhaul-609] rejects late folder-save resumption after its module tab is explicitly closed", async () => {
  const boundary = storySprintModuleBoundary();
  let release!: () => void;
  let saving = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  boundary.mount({ shell: true, unlinked: ["module-3"], children: <><NavigationActions moduleId="module-3" /><ModalHost /></>,
    graphQlExecute: async (document, variables) => {
      if (documentOperationName(document) === "SetModuleLink") {
        saving = true;
        await gate;
        const input = variables as { moduleId: string; path: string };
        return { set_module_link: { __typename: "ModuleLinks", id: "link-module-3", moduleId: input.moduleId, path: input.path } } as never;
      }
      return boundary.execute(document, variables);
    } });
  initializeStudioRuntime({ ...studioRuntime(), prepareDirectoryTrust: async () => ({ status: "already_trusted", approval: null }) });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(screen.getByRole("button", { name: "Explicit Open" }));
  const folder = await screen.findByRole("dialog", { name: "Module Folder" });
  fireEvent.change(within(folder).getByRole("textbox"), { target: { value: "/repos/module-3" } });
  fireEvent.click(within(folder).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saving).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide 0.2.0 tab" }));
  await waitFor(() => expect(screen.queryByRole("tab", { name: "0.2.0" })).not.toBeInTheDocument());
  await act(async () => { release(); });
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("dialog", { name: "Module Folder" })).not.toBeInTheDocument();
  expect(boundary.presentations.find((row) => row.module_id === "module-3")?.tab_hidden).toBe(true);
});

it("[overhaul-610] explains hidden sprint matches and explicitly restores the last closed matching tab", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await waitFor(() => expect(screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id"))).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Hide Roadmap tab" }));
  expect(await screen.findByText("All matching module tabs are hidden.")).toBeVisible();
  expect(screen.queryByText("No modules have stories in this sprint.")).not.toBeInTheDocument();
  expect(useClientStore.getState().selectedModuleId).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open module picker" }));
  fireEvent.click(screen.getByRole("option", { name: "Restore Roadmap module tab" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" })).toBeVisible();
  expect(screen.queryByText("All matching module tabs are hidden.")).not.toBeInTheDocument();
  expect(boundary.presentations.find((row) => row.module_id === "module-2")?.tab_hidden).toBe(true);
  expect(boundary.calls.filter((call) => call.operation === "UpdateWorkTrackerModulePresentation")).toEqual([
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-1", tabHidden: true } },
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-1", tabHidden: false } },
  ]);
});
