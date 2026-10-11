import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { ModalHost } from "../app/modal";
import { useModalStore } from "../app/modal/modalStore";
import { useClientStore } from "../state/clientStore";
import { openPlanWorkspace, leavePlanWorkspace, usePlanWorkspace } from "../features/sprints";
import { openModuleChangesWorkspace, leaveChangesWorkspace, useChangesWorkspace } from "../features/agents/worktrees";
import { rememberTaskSelection } from "../state/persistence";
import { setStorySprintFilterIntent } from "../features/work-items";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-496] prompts once for an unlinked fallback, leaves sprint tabs reachable on cancellation, and rejects stale folder resumption", async () => {
  const f = storySprintModuleBoundary();
  // This case exercises navigation guards with an explicitly open fallback.
  f.presentations[1] = { ...f.presentations[1]!, tab_hidden: false };
  f.mount({ unlinked: ["module-2"], children: <ModalHost /> });
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" }));
  fireEvent.click(await screen.findByRole("option", { name: /Sprint 25 planned/ }));
  await screen.findByRole("dialog", { name: "Module Folder" });
  expect(useClientStore.getState().selectedModuleId).toBeNull();
  const resume = (useModalStore.getState().modalStack[0].payload as { onSaved: () => void }).onSaved as () => void;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(useModalStore.getState().modalStack).toHaveLength(0));
  expect(screen.getByRole("button", { name: "Sprint: Sprint 25, Planned" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open module picker" })).toBeVisible();
  await act(async () => setStorySprintFilterIntent("project-1", { mode: "all" }));
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("module-1"));
  await act(async () => { resume(); });
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(useModalStore.getState().modalStack).toHaveLength(0);
});


it("[overhaul-497] defers sprint fallback during Plan and Changes, then restores the first matching module's remembered Story on return", async () => {
  const f = storySprintModuleBoundary();
  // This case exercises navigation guards with an explicitly open fallback.
  f.presentations[1] = { ...f.presentations[1]!, tab_hidden: false };
  f.mount();
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  rememberTaskSelection("module-2", "bugs-24");
  await act(async () => { openPlanWorkspace(); });
  expect(usePlanWorkspace.getState().active).toBe(true);
  await act(async () => { setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }); });
  await waitFor(() => expect(screen.getByRole("tab", { name: "bugs" })).toBeVisible());
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(useClientStore.getState().selectedTaskId).toBe("roadmap-24");
  expect(usePlanWorkspace.getState().active).toBe(true);
  await act(async () => { leavePlanWorkspace(); });
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("module-2"));
  await waitFor(() => expect(useClientStore.getState().selectedTaskId).toBe("bugs-24"));
  await act(async () => { openModuleChangesWorkspace("module-2"); });
  await act(async () => { setStorySprintFilterIntent("project-1", { mode: "none" }); });
  expect(useChangesWorkspace.getState().active).toBe(true);
  expect(useClientStore.getState().selectedModuleId).toBe("module-2");
  await act(async () => { leaveChangesWorkspace(); });
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBeNull());
  expect(await screen.findByText("No modules have stories in this sprint.")).toBeVisible();
});

it("[overhaul-498] resumes remembered Story restoration after a fallback load completes while Plan is active", async () => {
  const f = storySprintModuleBoundary();
  // This case exercises navigation guards with an explicitly open fallback.
  f.presentations[1] = { ...f.presentations[1]!, tab_hidden: false };
  let release!: () => void;
  let pending = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { documentOperationName } = await import("../graphql-foundation/typedDocument");
  f.mount({ graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "WorkTrackerModuleOpen" && (variables as { moduleId?: string }).moduleId === "module-2") {
      pending = true;
      await gate;
    }
    return f.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  rememberTaskSelection("module-2", "bugs-24");
  await act(async () => { setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }); });
  await waitFor(() => expect(pending).toBe(true));
  await act(async () => { openPlanWorkspace(); });
  await act(async () => { release(); });
  expect(usePlanWorkspace.getState().active).toBe(true);
  expect(useClientStore.getState().selectedTaskId).toBeNull();
  await act(async () => { leavePlanWorkspace(); });
  await waitFor(() => expect(useClientStore.getState().selectedTaskId).toBe("bugs-24"));
});

it("[overhaul-522] preserves an eligible module's deliberate empty Story selection on later sprint changes", async () => {
  const f = storySprintModuleBoundary();
  // This case exercises navigation guards with an explicitly open fallback.
  f.presentations[1] = { ...f.presentations[1]!, tab_hidden: false };
  f.mount();
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  rememberTaskSelection("module-2", "bugs-24");
  await act(async () => { setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }); });
  await waitFor(() => expect(useClientStore.getState().selectedTaskId).toBe("bugs-24"));
  await act(async () => { useClientStore.setState({ selectedTaskId: null }); });
  await act(async () => { setStorySprintFilterIntent("project-1", { mode: "active" }); });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  expect(useClientStore.getState().selectedModuleId).toBe("module-2");
  expect(useClientStore.getState().selectedTaskId).toBeNull();
});

it("[overhaul-523] rejects an old folder completion after Active rolls away from and back to the same sprint", async () => {
  const f = storySprintModuleBoundary();
  // This case exercises navigation guards with an explicitly open fallback.
  f.presentations[1] = { ...f.presentations[1]!, tab_hidden: false };
  f.mount({ selectedModuleId: "module-2", selectedTaskId: "bugs-24", unlinked: ["module-3"] });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await act(async () => { await useClientStore.getState().selectModule("module-3"); });
  const resume = (useModalStore.getState().modalStack[0].payload as { onSaved: () => void }).onSaved;
  const update = (activeId: string) => f.http.storySprints([
    { id: "sprint-24", projectId: "project-1", name: "Sprint 24", status: activeId === "sprint-24" ? "active" : "completed" },
    { id: "sprint-25", projectId: "project-1", name: "Sprint 25", status: activeId === "sprint-25" ? "active" : "planned" },
  ]);
  update("sprint-25");
  await act(async () => { fireEvent(window, new Event("focus")); });
  await screen.findByRole("button", { name: "Sprint: Sprint 25, Active" });
  update("sprint-24");
  await act(async () => { fireEvent(window, new Event("focus")); });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  const { seedModuleLinks, getModuleLinks } = await import("../features/module-links");
  seedModuleLinks([...getModuleLinks(), { id: "late-release-link", moduleId: "module-3", path: "/repos/release" }]);
  await act(async () => { resume(); });
  expect(useClientStore.getState().selectedModuleId).toBe("module-2");
  expect(useClientStore.getState().selectedTaskId).toBe("bugs-24");
});
