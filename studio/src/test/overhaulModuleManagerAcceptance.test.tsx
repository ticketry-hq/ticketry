import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-611] opens the grouped manager from the footer and preserves inspection, tabs and search focus", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, selectedTaskId: null });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  const footer = await screen.findByRole("button", { name: "Open Module Manager" });
  expect(footer).toHaveTextContent("3");
  footer.focus();
  fireEvent.click(footer);
  const manager = screen.getByRole("region", { name: "Module Manager" });
  expect(within(manager).getByText("Project")).toBeVisible();
  expect(within(manager).getByRole("searchbox", { name: "Search modules" })).toHaveFocus();
  expect(within(manager).getByRole("region", { name: "Open" })).toHaveTextContent("Roadmap");
  expect(within(manager).getByRole("region", { name: "Hidden" })).toHaveTextContent("bugs");
  expect(within(manager).getByRole("region", { name: /Not in sprint/ })).toHaveTextContent("0.2.0");
  expect(screen.getByRole("tab", { name: "Roadmap" })).toBeVisible();
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect bugs" }));
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  expect(boundary.calls.filter((call) => /^(Update|Reorder)/.test(call.operation))).toEqual([]);
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active", hidden: true })).toBeInTheDocument();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  await waitFor(() => expect(screen.getByRole("button", { name: "Open Module Manager" })).toHaveFocus());
});

it("[overhaul-615] restores explicitly without selecting, closes presentation only, and opens outside the sprint with an explanation", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, selectedTaskId: null });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager).getByRole("button", { name: "Restore bugs" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "bugs" })).toBeVisible());
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active", hidden: true })).toBeInTheDocument();
  fireEvent.click(within(manager).getByRole("button", { name: "Close bugs tab" }));
  await waitFor(() => expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull());
  const out = within(manager).getByRole("region", { name: /Not in sprint/ });
  expect(out).toHaveTextContent("Clears sprint filter");
  fireEvent.click(within(out).getByRole("button", { name: "Restore 0.2.0" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Sprint: All sprints", hidden: true })).toBeInTheDocument());
  expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(within(manager).getByRole("button", { name: "Open 0.2.0" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true");
  expect(boundary.calls.filter((call) => /^(Update|Reorder)/.test(call.operation))).toEqual([
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-2", tabHidden: false } },
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-2", tabHidden: true } },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  expect(screen.getByRole("button", { name: "Open 0.2.0" })).toBeEnabled();
});

it("[overhaul-616] keeps a reopened manager usable when an earlier Open finishes loading", async () => {
  const boundary = storySprintModuleBoundary();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "WorkTrackerModuleOpen" && (variables as { moduleId?: string }).moduleId === "module-3") {
      started = true; await pending;
    }
    return boundary.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  fireEvent.click(screen.getByRole("button", { name: "Open 0.2.0" }));
  await waitFor(() => expect(started).toBe(true));
  expect(useClientStore.getState().selectedModuleId).toBe("module-3");
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  await act(async () => { release(); await pending; });
  await waitFor(() => expect(screen.getByRole("button", { name: "Open 0.2.0" })).toBeEnabled());
  expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  expect(useClientStore.getState().selectedModuleId).toBe("module-3");
  expect(within(screen.getByRole("region", { name: "Module Manager" })).getByRole("searchbox", { name: "Search modules" })).toHaveFocus();
});
