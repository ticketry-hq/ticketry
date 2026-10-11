import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { resetStudioApolloClient } from "../shared/apollo/client";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import ToastHost from "../app/shell/ToastHost";

function tabs() {
  return screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id"));
}

it("[overhaul-600] closes selected sprint tabs without changing module records or order and retains visibility on reload", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.presentations[1] = { ...boundary.presentations[1]!, tab_hidden: false };
  let shell = boundary.mount({ shell: true, selectedTaskId: null });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await waitFor(() => expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual(["Roadmap", "bugs"]));
  expect(screen.getByRole("tab", { name: "Roadmap" })).not.toHaveAttribute("draggable", "true");
  const before = structuredClone({ modules: boundary.modules, ranks: boundary.presentations.map((row) => row.rank) });
  fireEvent.click(screen.getByRole("button", { name: "Hide Roadmap tab" }));
  await waitFor(() => expect(screen.queryByRole("tab", { name: "Roadmap" })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("tab", { name: "bugs" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" })).toBeVisible();
  expect(boundary.calls.filter((call) => /^(Update|Reorder)/.test(call.operation))).toEqual([
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-1", tabHidden: true } },
  ]);
  expect({ modules: boundary.modules, ranks: boundary.presentations.map((row) => row.rank) }).toEqual(before);
  shell.unmount();
  await act(async () => { await resetStudioApolloClient(); });
  shell = boundary.mount({ shell: true, selectedModuleId: "module-2", selectedTaskId: "bugs-24" });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await waitFor(() => expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual(["bugs"]));
  fireEvent.click(screen.getAllByRole("button", { name: "Show all sprints" })[0]!);
  await waitFor(() => expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual(["bugs", "0.2.0"]));
  shell.unmount();
});

it("[overhaul-601] rolls a failed sprint close back to the selected tab while preserving its filter", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.presentations[1] = { ...boundary.presentations[1]!, tab_hidden: false };
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_, fail) => { reject = fail; });
  const writes: unknown[] = [];
  boundary.mount({ shell: true, selectedTaskId: null, children: <ToastHost />, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "UpdateWorkTrackerModulePresentation") {
      writes.push(variables);
      return pending;
    }
    return boundary.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await waitFor(() => expect(tabs()).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Hide Roadmap tab" }));
  await waitFor(() => expect(screen.queryByRole("tab", { name: "Roadmap" })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("tab", { name: "bugs" })).toHaveAttribute("aria-selected", "true"));
  await act(async () => { reject(new Error("offline")); });
  await waitFor(() => expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" })).toBeVisible();
  expect(await screen.findByText(/Module tab could not be hidden: offline/)).toBeVisible();
  expect(writes).toEqual([{ moduleId: "module-1", tabHidden: true }]);
});

it("[overhaul-602] retains newer filter and keyboard navigation when an earlier close fails", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.presentations[1] = { ...boundary.presentations[1]!, tab_hidden: false };
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_, fail) => { reject = fail; });
  boundary.mount({ shell: true, selectedTaskId: null, children: <ToastHost />, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "UpdateWorkTrackerModulePresentation") return pending;
    return boundary.execute(document, variables);
  } });
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await waitFor(() => expect(tabs()).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Hide Roadmap tab" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "bugs" })).toHaveAttribute("aria-selected", "true"));
  fireEvent.click(screen.getAllByRole("button", { name: "Show all sprints" })[0]!);
  await screen.findByRole("button", { name: "Sprint: All sprints" });
  await waitFor(() => expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual(["bugs", "0.2.0"]));
  fireEvent.keyDown(window, { key: "2", code: "Digit2", metaKey: true });
  await waitFor(() => expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true"));
  await act(async () => { reject(new Error("offline")); });
  await waitFor(() => expect(tabs()).toHaveLength(3));
  expect(screen.getByRole("tab", { name: "0.2.0" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "Sprint: All sprints" })).toBeVisible();
});
