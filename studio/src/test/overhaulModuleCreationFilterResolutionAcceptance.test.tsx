import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { setStorySprintFilterIntent } from "../features/work-items";
import { getModuleFolder } from "../features/module-links";
import { moduleManagerCreationBoundary, fillModuleCreation } from "./moduleManagerCreationBoundary";

async function createDuringInitialResolution(changeIntent: boolean) {
  let releaseActive!: () => void;
  const activeGate = new Promise<void>((resolve) => { releaseActive = resolve; });
  const f = moduleManagerCreationBoundary({ holdCreate: true, wrapExecute: (execute) => async (document, variables) => {
    if (documentOperationName(document) === "StoryActiveSprint") {
      await activeGate;
    }
    return execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager.querySelector("header")!).getByRole("button", { name: "New module" }));
  fillModuleCreation(manager);
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  await waitFor(() => expect(f.createPending()).toBe(true));
  if (changeIntent) act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }));
  await act(async () => { releaseActive(); });
  if (!changeIntent) await screen.findByRole("button", { name: "Sprint: Sprint 24, Active", hidden: true });
  await act(async () => { f.releaseCreate(); });
  if (changeIntent) {
    await waitFor(() => expect(within(manager).getByRole("button", { name: "Save folder" })).toBeEnabled());
    expect(f.writes.filter(({ operation }) => operation === "SetModuleLink")).toEqual([]);
    expect(manager).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Fresh module", selected: true })).toBeNull();
    fireEvent.click(within(manager).getByRole("button", { name: "Save folder" }));
  }
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(getModuleFolder("created-module")).toBe("/repos/new-module");
  expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
  expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
  expect(f.writes.filter(({ operation }) => operation === "SetModuleLink").map(({ variables }) => variables)).toEqual([
    { moduleId: "created-module", path: "/repos/new-module" },
  ]);
}

it("[overhaul-811] initial active-sprint resolution during module creation preserves folder setup and selection", async () => {
  await createDuringInitialResolution(false);
});

it("[overhaul-812] explicit sprint intent changes cancel late setup and retry reuses the created module", async () => {
  await createDuringInitialResolution(true);
});
