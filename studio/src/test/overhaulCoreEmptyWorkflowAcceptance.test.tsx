import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { useModalStore } from "../app/modal/modalStore";
import { useClientStore } from "../state/clientStore";
import { newProjectFixture } from "./newProjectFixture";

const NO_WORKFLOW = "No workflow yet";

it("[CODING-2860] a core project without a workflow says so instead of showing an empty board", async () => {
  newProjectFixture("empty").mount();
  const stories = within(await screen.findByTestId("tasks-pane-body"));
  expect(await stories.findByText(NO_WORKFLOW)).toBeVisible();
  expect(stories.getAllByText(NO_WORKFLOW)).toHaveLength(1);
  expect(stories.queryByText("No stories")).toBeNull();
  expect(stories.queryByText(/No stories in this sprint/)).toBeNull();
  // Conversations are module-scoped, not workflow-scoped, so they stay available.
  expect(await stories.findByTitle("Start a conversation with the default agent")).toBeVisible();
});

it("[CODING-2860] idea entry is disabled without a workflow and typing never raises a failing toast", async () => {
  const f = newProjectFixture("empty");
  f.mount();
  const stories = within(await screen.findByTestId("tasks-pane-body"));
  await stories.findByText(NO_WORKFLOW);
  const idea = stories.getByRole("textbox", { name: "Capture an idea" });
  expect(idea).toBeDisabled();
  expect(idea).toHaveAttribute("placeholder", NO_WORKFLOW);
  fireEvent.change(idea, { target: { value: "An idea with nowhere to go" } });
  fireEvent.keyDown(idea, { key: "Enter" });
  await act(async () => { await Promise.resolve(); });
  expect(useClientStore.getState().toasts).toEqual([]);
  expect(f.writes).toEqual([]);
});

it("[CODING-2860] modules can still be created in a project without a workflow", async () => {
  const f = newProjectFixture("empty");
  f.mount();
  await within(await screen.findByTestId("tasks-pane-body")).findByText(NO_WORKFLOW);
  act(() => { useModalStore.getState().pushModal({ type: "add-module" }); });
  fireEvent.change(await screen.findByRole("textbox", { name: "Module name" }), { target: { value: "Fresh module" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Module folder" }), { target: { value: "/repos/new-module" } });
  fireEvent.click(screen.getByRole("button", { name: "Create module" }));
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("created-module"));
  expect(f.writes[0]).toEqual({ operation: "CreateWorkTrackerWorkItem", variables: {
    projectId: "project-1", name: "Fresh module", issueTypeId: "module-type", parentId: null,
  } });
  expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
  expect(useModalStore.getState().modalStack).toHaveLength(0);
  expect(useClientStore.getState().toasts).toEqual([]);
  expect(within(screen.getByTestId("tasks-pane-body")).getByText(NO_WORKFLOW)).toBeVisible();
});
