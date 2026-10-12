import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { useClientStore } from "../state/clientStore";
import { newProjectFixture } from "./newProjectFixture";

it("[CODING-2860] a new Pocock project keeps its reviewed workflow and never says it has none", async () => {
  const f = newProjectFixture("reviewed");
  f.mount();
  const stories = within(await screen.findByTestId("tasks-pane-body"));
  const idea = await stories.findByRole("textbox", { name: "Capture an idea" });
  expect(idea).toBeEnabled();
  expect(idea).toHaveAttribute("placeholder", "Capture an idea…");
  expect(screen.queryByText("No workflow yet")).toBeNull();

  fireEvent.change(idea, { target: { value: "First reviewed idea" } });
  fireEvent.keyDown(idea, { key: "Enter" });
  await waitFor(() => expect(stories.getByRole("treeitem", { name: /First reviewed idea/ }))
    .toHaveAttribute("data-task-id", "created-story"));
  expect(stories.getByRole("treeitem", { name: /First reviewed idea/ })).toBeVisible();
  expect(stories.getByRole("button", { name: "Collapse Ideas" })).toBeVisible();
  expect(f.writes[0]).toEqual({ operation: "CreateWorkTrackerWorkItem", variables: expect.objectContaining({
    name: "First reviewed idea", issueTypeId: "type-story", parentId: "module-1",
  }) });
  await waitFor(() => expect(useClientStore.getState().toasts).toEqual([]));
  expect(screen.queryByText("No workflow yet")).toBeNull();
});
