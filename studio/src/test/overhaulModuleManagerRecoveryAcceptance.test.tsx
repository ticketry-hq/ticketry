import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-621] counts hidden active modules, scopes attention and recovers safely from all-hidden and empty projects", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.presentations.forEach((row, index) => { boundary.presentations[index] = { ...row, tab_hidden: true }; });
  let shell = boundary.mount({ shell: true, selectedTaskId: null });
  const footer = await screen.findByRole("button", { name: "Open Module Manager" });
  await waitFor(() => expect(footer).toHaveTextContent("3"));
  act(() => useAgentStatusStore.setState({ runs: { "attention-run": {
    agent_run_id: "attention-run", project_id: "project-1", task_id: "bugs-24", module_id: "module-2",
    agent: "codex", scope: "task", state: "needs_input", started_at: "2026-10-09T06:00:00Z",
    updated_at: "2026-10-09T06:00:01Z", attention_reason: "Needs input",
  } } }));
  expect(within(footer).getByLabelText("Modules need attention")).toBeVisible();
  expect(footer.querySelector("svg")).toHaveAttribute("width", "14");
  act(() => useAgentStatusStore.setState({ runs: {} }));
  expect(within(footer).queryByLabelText("Modules need attention")).toBeNull();
  fireEvent.click(footer);
  expect(screen.getByRole("button", { name: "Close Module Manager", pressed: true })).toBeVisible();
  const manager = screen.getByRole("region", { name: "Module Manager" });
  expect(within(manager).getByRole("region", { name: "Hidden" })).toHaveTextContent("Roadmap");
  expect(within(manager).getByRole("region", { name: "Hidden" })).toHaveTextContent("bugs");
  expect(within(manager).getByRole("region", { name: "Hidden" })).toHaveTextContent("0.2.0");
  expect(screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id"))).toHaveLength(0);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  shell.unmount();
  const empty = storySprintModuleBoundary();
  empty.modules.splice(0);
  shell = empty.mount({ shell: true, selectedModuleId: null, selectedTaskId: null });
  const emptyFooter = await screen.findByRole("button", { name: "Open Module Manager" });
  await waitFor(() => expect(emptyFooter).toHaveTextContent("0"));
  fireEvent.click(emptyFooter);
  expect(within(screen.getByRole("region", { name: "Module Manager" })).getByRole("region", { name: "Open" })).toHaveTextContent("No modules");
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Open Module Manager" })).toHaveFocus());
  shell.unmount();
});

it("[overhaul-654] opens reachable manager recovery when every tab is hidden or the project is empty", async () => {
  const hidden = storySprintModuleBoundary();
  hidden.presentations.forEach((row, index) => { hidden.presentations[index] = { ...row, tab_hidden: true }; });
  let shell = hidden.mount({ shell: true, selectedModuleId: null, selectedTaskId: null });
  fireEvent.click(await screen.findByRole("button", { name: "Manage modules" }));
  expect(within(screen.getByRole("region", { name: "Module Manager" })).getByRole("region", { name: "Hidden" })).toHaveTextContent("Roadmap");
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  shell.unmount();

  const empty = storySprintModuleBoundary();
  empty.modules.splice(0);
  shell = empty.mount({ shell: true, selectedModuleId: null, selectedTaskId: null });
  fireEvent.click(await screen.findByRole("button", { name: "New module" }));
  expect(within(screen.getByRole("region", { name: "Module Manager" })).getByRole("form", { name: "Create module" })).toBeVisible();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  shell.unmount();
});
