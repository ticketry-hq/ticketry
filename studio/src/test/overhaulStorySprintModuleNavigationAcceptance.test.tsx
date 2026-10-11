import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

function tabNames() { return screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id")).map((tab) => tab.getAttribute("aria-label")); }

it("[overhaul-488] shares sprint-driven tab order with number shortcuts and restores saved visibility under All", async () => {
  const boundary = storySprintModuleBoundary(); boundary.mount();
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await waitFor(() => expect(tabNames()).toEqual(["Roadmap"]));
  expect(screen.getByRole("button", { name: "Hide Roadmap tab" })).toBeEnabled();
  expect(screen.getByRole("tab", { name: "Roadmap" })).not.toHaveAttribute("draggable", "true");
  fireEvent.keyDown(window, { key: "1", code: "Digit1", metaKey: true });
  await waitFor(() => expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true"));
  fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), { target: { value: "missingword" } });
  expect(tabNames()).toEqual(["Roadmap"]);
  fireEvent.click(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" }));
  fireEvent.click(await screen.findByRole("option", { name: /Sprint 25 planned/i }));
  await waitFor(() => expect(tabNames()).toEqual(["0.2.0"]));
  fireEvent.keyDown(window, { key: "1", code: "Digit1", metaKey: true });
  await waitFor(() => expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true"));
  expect(boundary.calls.filter((call) => call.operation === "UpdateWorkTrackerModulePresentation")).toEqual([]);
  fireEvent.click(screen.getAllByRole("button", { name: "Show all sprints" })[0]!);
  await waitFor(() => expect(tabNames()).toEqual(["Roadmap", "0.2.0"]));
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("draggable", "true");
  expect(screen.getByRole("button", { name: "Hide Roadmap tab" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Hide Roadmap tab" }));
  await waitFor(() => expect(tabNames()).toEqual(["0.2.0"]));
  expect(boundary.presentations.find((row) => row.module_id === "module-2")?.tab_hidden).toBe(true);
});

it("[overhaul-489] keeps manager inspection separate from explicit Restore and Open", async () => {
  const boundary = storySprintModuleBoundary(); boundary.mount({ shell: true });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await waitFor(() => expect(tabNames()).toEqual(["Roadmap"]));
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect bugs" }));
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active", hidden: true })).toBeInTheDocument();
  expect(boundary.calls.filter((call) => call.operation === "UpdateWorkTrackerModulePresentation")).toEqual([]);
  expect(boundary.presentations.find((row) => row.module_id === "module-2")?.tab_hidden).toBe(true);
  fireEvent.click(within(within(manager).getByRole("region", { name: "Hidden" })).getByRole("button", { name: "Restore bugs" }));
  await waitFor(() => expect(tabNames()).toEqual(["Roadmap", "bugs"]));
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active", hidden: true })).toBeInTheDocument();
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect 0.2.0" }));
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active", hidden: true })).toBeInTheDocument();
  const out = within(manager).getByRole("region", { name: "Not in sprint" });
  expect(out).toHaveTextContent("Clears sprint filter");
  fireEvent.click(within(out).getByRole("button", { name: "Open 0.2.0" }));
  await screen.findByRole("button", { name: "Sprint: All sprints" });
  await waitFor(() => expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true"));
  expect(tabNames()).toEqual(["Roadmap", "bugs", "0.2.0"]);
});

it("[overhaul-490] keeps picker Show all recovery keyboard reachable with zero sprint tabs", async () => {
  const boundary = storySprintModuleBoundary(); boundary.mount();
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" }));
  fireEvent.click(await screen.findByRole("option", { name: /Empty sprint planned/i }));
  await waitFor(() => expect(tabNames()).toEqual([]));
  fireEvent.click(screen.getByRole("button", { name: "Open module picker" }));
  const picker = screen.getByRole("dialog", { name: "Module picker" });
  const recovery = within(picker).getByRole("option", { name: "Show all sprints" });
  expect(recovery).toBeVisible();
  const search = within(picker).getByRole("combobox", { name: "Search modules" });
  expect(search).toHaveFocus();
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(search).toHaveAttribute("aria-activedescendant", recovery.id);
  fireEvent.keyDown(search, { key: "Enter" });
  await waitFor(() => expect(tabNames()).toEqual(["Roadmap", "0.2.0"]));
  fireEvent.click(screen.getByRole("button", { name: "Open module picker" }));
  fireEvent.click(await screen.findByRole("option", { name: "Restore bugs module tab" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "bugs" })).toHaveAttribute("aria-selected", "true"));
  expect(boundary.calls.filter((call) => call.operation === "UpdateWorkTrackerModulePresentation")).toEqual([
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-2", tabHidden: false } },
  ]);
});

it("[overhaul-603] restores eligible sprint tabs from the picker without clearing the filter", async () => {
  const boundary = storySprintModuleBoundary(); boundary.mount({ shell: true });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await waitFor(() => expect(tabNames()).toEqual(["Roadmap"]));
  fireEvent.click(screen.getByRole("button", { name: "Open module picker" }));
  fireEvent.click(await screen.findByRole("option", { name: "Restore bugs module tab" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "bugs" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" })).toBeVisible();
  expect(boundary.calls.filter((call) => call.operation === "UpdateWorkTrackerModulePresentation")).toEqual([
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-2", tabHidden: false } },
  ]);
});
