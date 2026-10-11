import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { TicketWorkspace } from "../app/shell/ticket-workspace/TicketWorkspace";
import { StudioFooter } from "../app/shell/StudioFooter";
import { StudioLayout } from "../app/shell/StudioLayout";
import { useChangesWorkspace } from "../features/agents/worktrees";
import { WorktreeSwitcher } from "../features/agents/worktrees/changes/WorktreeSwitcher";
import { usePlanWorkspace } from "../features/sprints";
import { PlanningGraphDocument } from "../features/planning-graph";
import { studioApolloClient } from "../shared/apollo/client";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio } from "./seam";

function cacheEmptyPlan(withModule = false) {
  const data = {
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [] }, issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] }, modules: { __typename: "WorktrackerIssueConnection", nodes: withModule ? [
      { __typename: "WorktrackerIssue", id: "module-1", name: "Module 1", sequenceId: 1, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } },
    ] : [] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: [] }, sprints: { __typename: "WorktrackerSprintConnection", nodes: [] },
  };
  studioApolloClient().writeQuery({ query: PlanningGraphDocument, variables: { projectId: "project-1" }, data });
}

function KeyboardTabs() {
  useGlobalKeymap();
  return <ModuleTabStrip />;
}

function KeyboardLayout() {
  useGlobalKeymap();
  return <StudioLayout />;
}

function KeyboardTabsWithCheckout() {
  const active = useChangesWorkspace((state) => state.active);
  const moduleId = useChangesWorkspace((state) => state.moduleId);
  const taskId = useChangesWorkspace((state) => state.taskId);
  return <><KeyboardTabs />{active ? <WorktreeSwitcher
    moduleId={moduleId} selectedTaskId={taskId}
    onOpenModule={() => {}} onOpenTask={() => {}} /> : null}</>;
}

describe("overhaul acceptance - workspace surfaces", () => {
  beforeEach(() => {
    usePlanWorkspace.setState(usePlanWorkspace.getInitialState(), true);
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  it("[overhaul-453] puts Plan and module-scoped Changes ahead of modules and leaves each surface when switching", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({ http, children: <><ModuleTabStrip /><StudioFooter /></> });
    const strip = screen.getByRole("tablist", { name: "Project module tabs" });
    await waitFor(() => expect(within(strip).getAllByRole("tab")).toHaveLength(3));
    const tabs = within(strip).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["◆Plan", "Changes · Module 1", "Module 1"]);
    const [plan, changes, module] = tabs;
    fireEvent.click(plan);
    expect(plan).toHaveAttribute("aria-selected", "true");
    expect(module).toHaveAttribute("aria-selected", "false");
    fireEvent.click(changes);
    expect(changes).toHaveAttribute("aria-selected", "true");
    expect(plan).toHaveAttribute("aria-selected", "false");
    expect(usePlanWorkspace.getState().active).toBe(false);
    expect(useChangesWorkspace.getState().moduleId).toBe("module-1");
    fireEvent.click(module);
    await waitFor(() => expect(module).toHaveAttribute("aria-selected", "true"));
    expect(useChangesWorkspace.getState().active).toBe(false);
    expect(document.querySelector('[data-studio-status-bar] [role="tab"]')).toBeNull();
  });
  it("[overhaul-454] gives Plan the full width without losing the saved Stories/workspace split or mounted workspace", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({ http, children: <KeyboardLayout /> });
    await screen.findByRole("tab", { name: "Module 1" });
    const workspace = screen.getByTestId("module-workspace-region").querySelector('[data-panel-group]');
    act(() => {
      useClientStore.setState({ selectedModuleId: null, panelLayout: [37.5, 62.5] });
      cacheEmptyPlan(true);
    });
    expect(screen.queryByTestId("pane-modules")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.queryByTestId("pane-modules")).not.toBeInTheDocument();
    expect(useClientStore.getState()).toMatchObject({ panelLayout: [37.5, 62.5] });
    expect(usePlanWorkspace.getState().active).toBe(true);
    expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("module-workspace-region").querySelector('[data-panel-group]')?.parentElement).toHaveAttribute("hidden");
    expect(await screen.findByText("Sprints")).toBeVisible();
    expect(screen.getByTestId("module-workspace-region").querySelector('[data-panel-group]')).toBe(workspace);
    // Exit Plan without initiating new module/folder navigation: its saved
    // origin deliberately had no module selected.
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(usePlanWorkspace.getState().active).toBe(false));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Plan" })).toHaveFocus());
    expect(useClientStore.getState().selectedModuleId).toBeNull();
    expect(screen.getByRole("tab", { name: "Module 1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByTestId("pane-modules")).toBeNull();
    expect(useClientStore.getState()).toMatchObject({ panelLayout: [37.5, 62.5] });
    expect(screen.getByTestId("module-workspace-region").querySelector('[data-panel-group]')).toBe(workspace);
  });

  it("[overhaul-455] roves across Plan, Changes and modules with arrows, Home and End", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({ http, children: <KeyboardTabsWithCheckout /> });
    const module = await screen.findByRole("tab", { name: "Module 1" });
    const plan = screen.getByRole("tab", { name: "Plan" });
    const changes = screen.getByRole("tab", { name: "Changes · Module 1" });
    expect(module).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(module, { key: "Home" });
    expect(plan).toHaveFocus();
    expect(plan).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(plan, { key: "ArrowRight" });
    await screen.findByRole("button", { name: "Choose checkout" });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(changes).toHaveFocus();
    expect(changes).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(changes, { key: "End" });
    expect(module).toHaveFocus();
    fireEvent.keyDown(module, { key: "ArrowRight" });
    expect(plan).toHaveFocus();
    fireEvent.keyDown(plan, { key: "ArrowLeft" });
    expect(module).toHaveFocus();
  });

  it("[overhaul-456] opens project-wide Plan even when the project has no modules", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({ http, children: <TicketWorkspace tasksSize={40} workspaceSize={60}
      groupRef={createRef<ImperativePanelGroupHandle>()} onLayout={() => {}} />,
      graphQlExecute: async (document, variables) => {
        const result = await http.executeGraphQl(document, variables);
        if (documentOperationName(document) === "WorkTrackerProjectOpen") {
          return { ...result, modules: { __typename: "WorktrackerIssueConnection", nodes: [] } };
        }
        return result;
      },
    });
    expect(await screen.findByTestId("empty-project-workspace")).toBeVisible();
    act(() => { useClientStore.setState({ selectedModuleId: null }); cacheEmptyPlan(); });
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
    expect(await screen.findByRole("heading", { name: "Sprints" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Changes" })).toBeDisabled();
    expect(screen.getByTestId("empty-project-workspace")).not.toBeVisible();
  });

  it("[overhaul-460] leaves the Plan sprint list with bare Escape and refocuses Plan", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({ http, children: <KeyboardTabs /> });
    await screen.findByRole("tab", { name: "Module 1" });
    act(cacheEmptyPlan);
    const plan = screen.getByRole("tab", { name: "Plan" });
    fireEvent.click(plan);
    fireEvent.keyDown(document.body, { key: "Escape", shiftKey: true });
    expect(plan).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(plan).toHaveAttribute("aria-selected", "false");
    await waitFor(() => expect(plan).toHaveFocus());
  });

  it("does not show module-workspace keyboard hints while Plan owns the work area", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({ http, children: <><KeyboardTabs /><StudioFooter /></> });
    await screen.findByRole("tab", { name: "Module 1" });
    act(() => {
      useClientStore.setState({ sidebarVisible: false, editViewZone: "stories" });
      cacheEmptyPlan();
    });
    expect(screen.getByText(/Next Zone/)).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.queryByText(/Next Zone/)).not.toBeInTheDocument();
  });

});
