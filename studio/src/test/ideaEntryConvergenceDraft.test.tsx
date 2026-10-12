import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createWorkItemInvalidator } from "../features/agents/status/stream/workItemInvalidation";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

const invalidator = createWorkItemInvalidator();
afterEach(() => invalidator.cancel());

it("[CODING-2868] keeps a typed idea while a captured Story's membership fact converges the project", async () => {
  const boundary = storySprintModuleBoundary();
  // Hold the project re-read the convergence owes, as a real round trip does.
  let holdProjectReads = false;
  let projectReads = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  boundary.mount({ selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "WorkTrackerProjectOpen") {
      projectReads += 1;
      if (holdProjectReads) await released;
    }
    return boundary.execute(document, variables);
  } });
  await screen.findByRole("treeitem", { name: /Roadmap current story/ });
  const entry = screen.getByRole("textbox", { name: "Capture an idea" });
  fireEvent.change(entry, { target: { value: "Story typed right after a capture" } });
  const readsBefore = projectReads;
  holdProjectReads = true;

  // The capture's own `work_item.changed` fact arrives after the field cleared.
  act(() => {
    invalidator.record({ family: "work_item", workItemId: "roadmap-24", projectId: "project-1", moduleId: "module-1",
      itemKind: "task", removed: false, membershipChanged: true, occurredAt: null });
    invalidator.flush();
  });
  await waitFor(() => expect(projectReads).toBeGreaterThan(readsBefore));
  expect(screen.queryByTestId("empty-project-workspace")).toBeNull();
  expect(screen.getByRole("textbox", { name: "Capture an idea" })).toHaveValue("Story typed right after a capture");

  await act(async () => { release(); await released; });
  await waitFor(() => expect(screen.getByRole("treeitem", { name: /Roadmap current story/ })).toBeVisible());
  expect(screen.getByRole("textbox", { name: "Capture an idea" })).toBe(entry);
  expect(entry).toHaveValue("Story typed right after a capture");
});
