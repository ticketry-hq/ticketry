import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";
import { openPlanWorkspace, usePlanWorkspace } from "../features/sprints";
import { openPlanSprint, openPlanItem } from "../features/sprints/planWorkspaceState";
import { useClientStore } from "../state/clientStore";
import { useTerminalStore } from "../features/agents/terminal";
import { SprintsWorkspace } from "../features/sprints";
import SprintsView from "../features/sprints/SprintsView";
import { useChangesWorkspace } from "../features/agents/worktrees";
import { ModalHost } from "../app/modal";
import { useModalStore } from "../app/modal/modalStore";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { EDITION, editionHas } from "../shared/config/edition";

it("[overhaul-745] Pocock direct Plan view preserves remembered visits and sends no planning requests", async () => {
  const f = editionAcceptanceFixture();
  const visits = { "sprint-25": { epicTabs: ["deleted-epic", "module-3"], activeEpicId: "deleted-epic" } };
  act(() => usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint-25", visits }));
  f.mount({ children: <PlanSprintView projectId="project-1" sprintId="sprint-25" renderWorkItemDetail={() => null} /> });
  await screen.findByRole("tab", { name: "Roadmap" });
  expect(screen.queryByTestId("plan-sprint")).not.toBeInTheDocument();
  expect(usePlanWorkspace.getState().visits).toEqual(visits);
  expect(f.calls.filter(({ operation }) => ["PlanningGraph", "SprintGoals", "SprintSuggestions", "SprintSuggestionExecution"].includes(operation))).toEqual([]);
});

it("[overhaul-527] compiled Pocock edition omits the Plan workspace from the full Studio shell", async () => {
  const f = editionAcceptanceFixture();
  f.mount();
  const tabs = within(await screen.findByRole("tablist", { name: "Project module tabs" }));
  await screen.findByRole("tab", { name: "Roadmap" });
  expect(tabs.queryByRole("tab", { name: "Plan" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Sprints" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("plan-sprint")).not.toBeInTheDocument();
  expect(screen.queryByTestId("sprints-list")).not.toBeInTheDocument();
  expect(screen.queryByText("Ship retained goal")).not.toBeInTheDocument();
  expect(screen.queryByText("Retained suggestion")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "New sprint" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Find stories for these goals/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: /^(Start|Complete) Sprint/ })).not.toBeInTheDocument();
  expect(f.calls.filter(({ operation }) => ["SprintGoals", "SprintSuggestions", "SprintSuggestionExecution"].includes(operation))).toEqual([]);
});

it("[overhaul-530] Pocock public Plan entries preserve the selected module, Story and terminal", async () => {
  const f = editionAcceptanceFixture();
  f.mount();
  await screen.findByRole("tab", { name: "Roadmap" });
  act(f.seedTerminal);
  const selection = () => {
    const state = useClientStore.getState();
    return { module: state.selectedModuleId, story: state.selectedTaskId, selection: state.workspaceSelection,
      terminal: state.activeByTask["roadmap-24"], workspace: state.workspaces["roadmap-24"] };
  };
  const before = selection();
  const records = JSON.stringify([f.graph, f.goals, f.suggestions, f.presentations]);
  act(() => openPlanWorkspace());
  expect(usePlanWorkspace.getState().active).toBe(false);
  expect(selection()).toEqual(before);
  act(() => openPlanSprint("sprint-25"));
  expect(usePlanWorkspace.getState().active).toBe(false);
  expect(selection()).toEqual(before);
  // A public item request must also refuse a directly seeded stale Plan visit.
  act(() => usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint-25", openItem: "origin" }));
  const stale = usePlanWorkspace.getState();
  await act(async () => { await openPlanItem("release-25", "suggestion-25"); });
  expect(selection()).toEqual(before);
  expect(usePlanWorkspace.getState()).toEqual(stale);
  expect(useTerminalStore.getState().sessionByRun["run-retained"]).toBe("viewer-retained");
  expect(JSON.stringify([f.graph, f.goals, f.suggestions, f.presentations])).toBe(records);
  expect(f.calls.filter(({ operation }) => /^(Create|Update|Delete)(Sprint|Planning)|UpdateWorkTrackerModulePresentation|UpdateTerminalSession/.test(operation))).toEqual([]);
});

it("[overhaul-531] stale Plan state in Pocock cannot own the manager, footer, workspace or visible keyboard traversal", async () => {
  const f = editionAcceptanceFixture({ withDocument: true });
  f.mount();
  const module = await screen.findByRole("tab", { name: "Roadmap" });
  const workspace = screen.getByTestId("module-workspace-region").querySelector('[data-panel-group]');
  act(() => {
    useClientStore.setState({ focusedPane: "tasks", editViewZone: "stories", editViewBodyEngaged: false, panelLayout: [37.5, 62.5] });
    usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint-25", openItem: "suggestion:suggestion-25",
      origin: { selectedModuleId: "module-3", selectedTaskId: "release-25", workspaceSelection: { kind: "task" },
        focusedPane: "details-or-terminal", editViewZone: "active-tab-body", editViewBodyEngaged: true, sidebarVisible: false, panelLayout: [20 / 90 * 100, 70 / 90 * 100] } });
  });
  expect(screen.queryByTestId("pane-modules")).toBeNull();
  expect(screen.getByRole("button", { name: "Open Module Manager" })).toBeVisible();
  expect(module).toHaveAttribute("aria-selected", "true");
  expect(workspace).toBeVisible();
  expect(screen.queryByTestId("plan-sprint")).not.toBeInTheDocument();
  act(() => useClientStore.setState({ sidebarVisible: false }));
  expect(screen.getByText(/Next Zone/)).toBeVisible();
  fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
  expect(useClientStore.getState().editViewZone).toBe("tab-strip");
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(usePlanWorkspace.getState().openItem).toBe("suggestion:suggestion-25");
  expect(useClientStore.getState()).toMatchObject({ selectedModuleId: "module-1", selectedTaskId: "roadmap-24", panelLayout: [37.5, 62.5] });
  const changes = screen.getByRole("tab", { name: "Changes · Roadmap" });
  fireEvent.keyDown(module, { key: "Home" });
  expect(changes).toHaveFocus();
  expect(changes).toHaveAttribute("aria-selected", "true");
  const last = within(screen.getByRole("tablist", { name: "Project module tabs" })).getAllByRole("tab").at(-1)!;
  fireEvent.keyDown(changes, { key: "End" });
  expect(last).toHaveFocus();
  await waitFor(() => expect(last).toHaveAttribute("aria-selected", "true"));
  expect(useChangesWorkspace.getState().active).toBe(false);
  fireEvent.click(module);
  await waitFor(() => expect(module).toHaveAttribute("aria-selected", "true"));
  act(() => useClientStore.getState().selectTask("roadmap-24"));
  const details = screen.getByRole("tab", { name: "Details" });
  const design = await screen.findByRole("tab", { name: "DESIGN" });
  fireEvent.click(details);
  fireEvent.keyDown(document.body, { key: "ArrowRight", metaKey: true });
  expect(design).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(document.body, { key: "w", metaKey: true });
  expect(useClientStore.getState().workspaces["roadmap-24"].closedDocIds).toContain("design");
  expect(usePlanWorkspace.getState().openItem).toBe("suggestion:suggestion-25");
  expect(f.calls.filter(({ operation }) => /^(Create|Update|Delete)(Sprint|Planning)|UpdateWorkTrackerModulePresentation|UpdateTerminalSession/.test(operation))).toEqual([]);
});

it("Pocock refuses direct public planning mounts even with seeded active Plan state", async () => {
  const f = editionAcceptanceFixture();
  f.mount({ children: <>
    <SprintsWorkspace renderWorkItemDetail={(id) => <p>Direct planning detail {id}</p>} />
    <SprintsView projectId="project-1" renderSprintGoals={() => <p>Direct sprint goals</p>}
      renderSuggestionAgentBox={() => <p>Direct suggestion control</p>} />
  </> });
  await screen.findByRole("tab", { name: "Roadmap" });
  act(() => usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint-25" }));
  expect(screen.queryByRole("heading", { name: "Sprints" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("plan-sprint")).not.toBeInTheDocument();
  expect(screen.queryByText("Direct sprint goals")).not.toBeInTheDocument();
  expect(screen.queryByText("Direct suggestion control")).not.toBeInTheDocument();
});

it("[overhaul-532] Pocock retains separate agent Plan conversations and Plan a feature", async () => {
  const f = editionAcceptanceFixture();
  f.mount({ children: <ModalHost /> });
  await screen.findByRole("tab", { name: "Roadmap" });
  act(() => useClientStore.setState({ editViewBodyEngaged: false }));
  fireEvent.keyDown(document.body, { key: "n" });
  const prompt = await screen.findByRole("dialog", { name: "Prompt" });
  expect(useModalStore.getState().modalStack.at(-1)?.payload).toMatchObject({ next: "agent-picker", nextPayload: { mode: "plan" } });
  fireEvent.change(within(prompt).getByRole("textbox"), { target: { value: "Plan the next feature" } });
  fireEvent.click(within(prompt).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(useModalStore.getState().modalStack.at(-1)?.type).toBe("agent-picker"));
  expect(useModalStore.getState().modalStack.at(-1)?.payload).toMatchObject({ mode: "plan", initialPrompt: "Plan the next feature" });
  expect(await screen.findByRole("dialog", { name: "Select Agent" })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Plan" })).not.toBeInTheDocument();
});

it("[overhaul-533] runtime environment, URL and saved settings cannot change the compiled Pocock edition", async () => {
  const f = editionAcceptanceFixture();
  f.mount();
  await screen.findByRole("tab", { name: "Roadmap" });
  try {
    vi.stubEnv("TICKETRY_EDITION", "core");
    localStorage.setItem("TICKETRY_EDITION", "core");
    localStorage.setItem("ticketry-settings", JSON.stringify({ edition: "core" }));
    window.history.replaceState({}, "", "/?edition=core&TICKETRY_EDITION=core");
    expect(EDITION).toBe("pocock");
    expect(editionHas("sprintPlanning")).toBe(false);
    act(() => openPlanWorkspace("sprint-25"));
    expect(screen.queryByRole("tab", { name: "Plan" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-sprint")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
    expect(usePlanWorkspace.getState().active).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});
