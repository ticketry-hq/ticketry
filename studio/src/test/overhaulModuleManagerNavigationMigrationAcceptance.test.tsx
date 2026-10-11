import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { useClientStore } from "../state/clientStore";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-656] ignores legacy sidebar cursor and visibility when navigating the remaining workspace", async () => {
  localStorage.setItem("studio.sidebarVisible:v2", "true");
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, sidebar: true });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  act(() => useClientStore.setState({ focusedPane: "tasks", editViewZone: "stories", modulesCursorId: "module-2" }));
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(useClientStore.getState().editViewZone).toBe("tab-strip");
  expect(screen.queryByTestId("modules-pane-title")).toBeNull();
  fireEvent.keyDown(window, { key: "\\" });
  expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search modules" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  act(() => {
    useClientStore.getState().setEditViewZone("stories");
    useClientStore.getState().focusLeft();
  });
  expect(useClientStore.getState().focusedPane).toBe("tasks");
  expect(screen.getByRole("button", { name: "Open Module Manager" })).toBeVisible();
  expect(boundary.calls.filter((call) => /^(UpdateWorkTrackerModulePresentation|UpdateWorkTrackerWorkItem|Reorder)/.test(call.operation))).toEqual([]);
});
