import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { fillModuleCreation, moduleManagerCreationBoundary } from "./moduleManagerCreationBoundary";
import { getStorySprintFilterIntent, setStorySprintFilterIntent } from "../features/work-items";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => command === "desktop_validate_module_folder" ? { valid: true, reason: null } : null,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

async function openPocockModuleCreation() {
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager.querySelector("header")!).getByRole("button", { name: "New module" }));
  fillModuleCreation(manager);
  return manager;
}

it("[overhaul-842] Pocock module creation completes folder setup and selection when hidden sprint intent changes during the create", async () => {
  const f = moduleManagerCreationBoundary({ holdCreate: true });
  const manager = await openPocockModuleCreation();
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  await waitFor(() => expect(f.createPending()).toBe(true));
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }));
  await act(async () => f.releaseCreate());
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
  expect(f.writes.map(({ operation }) => operation)).toEqual(["CreateWorkTrackerWorkItem", "SetModuleLink"]);
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "id", sprintId: "sprint-25" });
});

it("[overhaul-843] Pocock module creation preserves retained hidden sprint intent", async () => {
  moduleManagerCreationBoundary();
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }));
  const manager = await openPocockModuleCreation();
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "id", sprintId: "sprint-25" });
});
