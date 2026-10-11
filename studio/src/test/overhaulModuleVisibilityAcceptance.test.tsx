import { ApolloProvider } from "@apollo/client/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const projectReads = vi.hoisted(() => ({ readProjectOpen: vi.fn() }));

vi.mock("../features/projects/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/projects/queries/readTransport")),
  readProjectOpen: projectReads.readProjectOpen,
}));

import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { StudioFooter } from "../app/shell/StudioFooter";
import { StudioLayout } from "../app/shell/StudioLayout";
import { ModuleManager, openModuleManager } from "../features/module-manager";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { seedModuleLinks } from "../features/module-links";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useStudioStore } from "../features/projects/store";
import { setStorySprintFilterIntent } from "../features/work-items";
import { useModalStore } from "../app/modal/modalStore";
import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";
import type { Module, ModulePresentation, Project } from "../shared/api/types";
import {
  resetStudioApolloClient,
  studioApolloClient,
} from "../shared/apollo/client";
import { useClientStore } from "../state/clientStore";
import { RECENT_MODULE_KEY } from "../state/persistence";
import { projectOpenFixture } from "./projectOpenFixture";

const PROJECT_ID = "project-1";
const PROJECT: Project = {
  id: PROJECT_ID,
  name: "Project",
  slug: "PRJ",
  description: "",
};
const MODULES: Module[] = ["Alpha", "Bravo", "Charlie"].map((name, index) => ({
  id: "module-" + name[0]!.toLowerCase(),
  name,
  project_id: PROJECT_ID,
  key: "PRJ-" + (index + 1),
  sequence_id: index + 1,
  is_archived: false,
  issue_type: "module-type",
}));

let hiddenIds = new Set<string>();
let failNextVisibility = false;
let mutationCalls: Array<{ moduleId: string; tabHidden: boolean }> = [];
let modulesForRead = MODULES;

function presentation(moduleId: string): ModulePresentation {
  return {
    module_id: moduleId,
    rank: String(MODULES.findIndex((module) => module.id === moduleId)).padStart(8, "0"),
    tab_hidden: hiddenIds.has(moduleId),
  };
}

function projectOpenResult() {
  const result = projectOpenFixture(
    { ...PROJECT, manual_module_order: true },
    modulesForRead,
  );
  result.data.module_presentations.nodes = modulesForRead.map((module) => ({
    __typename: "WorktrackerModulepresentation",
    ...presentation(module.id),
    module: {
      __typename: "WorktrackerIssue",
      id: module.id,
      project_id: PROJECT_ID,
    },
  }));
  return result;
}

function installVisibilityTransport() {
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({
    ...browser,
    graphQlTransport: () => ({
      graphql_execute: async (requestJson: string) => {
        const request = JSON.parse(requestJson) as {
          operationName: string;
          variables: { moduleId: string; tabHidden: boolean };
        };
        if (request.operationName === "ModuleManagerArchivedModules") {
          return JSON.stringify({ data: { modules: { __typename: "WorktrackerIssueConnection", nodes: [],
            pageInfo: { __typename: "PageInfo", hasNextPage: false },
            paginationInfo: { __typename: "PaginationInfo", total: 0 } } } });
        }
        if (request.operationName !== "UpdateWorkTrackerModulePresentation") {
          throw new Error("Unexpected GraphQL operation " + request.operationName);
        }
        mutationCalls.push(request.variables);
        if (failNextVisibility) {
          failNextVisibility = false;
          return JSON.stringify({
            errors: [{ message: "visibility failed", extensions: { code: "validation" } }],
          });
        }
        if (request.variables.tabHidden) hiddenIds.add(request.variables.moduleId);
        else hiddenIds.delete(request.variables.moduleId);
        return JSON.stringify({
          data: {
            update_module_presentation: {
              __typename: "WorktrackerModulepresentation",
              ...presentation(request.variables.moduleId),
            },
          },
        });
      },
      graphql_subscribe: async () => "subscription",
      graphql_unsubscribe: async () => true,
    }),
  });
}

function tabNames(): string[] {
  return screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id")).map((tab) => tab.getAttribute("aria-label") ?? "");
}

const defaultDeselectModule = useClientStore.getState().deselectModule;

function RecoveryShell() {
  return (
    <ApolloProvider client={studioApolloClient()}>
      <StudioLayout />
      <StudioFooter />
    </ApolloProvider>
  );
}

describe("module tab visibility acceptance", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(async () => {
    await resetStudioApolloClient();
    setStorySprintFilterIntent(PROJECT_ID, { mode: "all" });
    hiddenIds = new Set();
    modulesForRead = MODULES;
    failNextVisibility = false;
    mutationCalls = [];
    seedModuleLinks([]);
    projectReads.readProjectOpen.mockReset().mockImplementation(async () => projectOpenResult());
    installVisibilityTransport();
    localStorage.clear();
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useAgentStatusStore.setState({ runs: {} });
    useModalStore.setState({ modalStack: [] });
    useClientStore.setState({
      selectedModuleId: null,
      selectedTaskId: null,
      selectModule: vi.fn(async (moduleId: string) => {
        useClientStore.setState({ selectedModuleId: moduleId });
      }),
      deselectModule: defaultDeselectModule,
      toasts: [],
    });
  });

  it("[overhaul-175] keeps a hidden tab hidden after a reload", async () => {
    const first = render(<ModuleTabStrip />);
    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Bravo", "Charlie"]));

    fireEvent.click(screen.getByRole("button", { name: "Hide Bravo tab" }));
    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Charlie"]));
    expect(hiddenIds).toEqual(new Set(["module-b"]));

    first.unmount();
    await resetStudioApolloClient();
    setStorySprintFilterIntent(PROJECT_ID, { mode: "all" });
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    render(<ModuleTabStrip />);

    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Charlie"]));
    expect(mutationCalls).toHaveLength(1);
  });

  it("[overhaul-176] does not reopen a hidden tab during agent activity", async () => {
    hiddenIds.add("module-b");
    render(<ModuleTabStrip />);
    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Charlie"]));

    useAgentStatusStore.setState({
      runs: {
        "run-1": { module_id: "module-b", state: "needs_input" },
      } as unknown as ReturnType<typeof useAgentStatusStore.getState>["runs"],
    });

    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Charlie"]));
    expect(mutationCalls).toEqual([]);
  });

  it("shows module creation for an empty project instead of recovery copy", async () => {
    modulesForRead = [];
    render(<RecoveryShell />);

    expect(
      await screen.findByText("No modules yet. Add a module to start planning work."),
    ).toBeVisible();
    expect(screen.queryByTestId("empty-module-workspace")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "New module" }));
    expect(await screen.findByRole("form", { name: "Create module" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
    expect(useModalStore.getState().modalStack).toEqual([]);
  });

  it("[overhaul-177] recovers hidden tabs explicitly from the footer manager while keeping lifecycle status", async () => {
    hiddenIds = new Set(MODULES.map((module) => module.id));
    useClientStore.setState({
      selectedModuleId: null,
      sidebarVisible: false,
      focusedPane: "tasks",
    });
    render(<RecoveryShell />);

    expect(await screen.findByTestId("empty-module-workspace")).toBeVisible();
    expect(screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id"))).toEqual([]);
    const openModules = screen.getByRole("button", {
      name: "Open Module Manager",
    });
    expect(openModules).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(openModules);
    const manager = await screen.findByRole("region", { name: "Module Manager" });
    expect(manager).toBeVisible();
    fireEvent.click(within(manager).getByRole("button", { name: "Inspect Bravo" }));
    expect(mutationCalls).toEqual([]);

    act(() => {
      useAgentStatusStore.setState({
        runs: {
          "run-1": { module_id: "module-b", state: "needs_input" },
        } as unknown as ReturnType<typeof useAgentStatusStore.getState>["runs"],
      });
    });
    const hiddenRow = document.querySelector<HTMLElement>(
      'li[data-module-manager-row="module-b"]',
    );
    expect(hiddenRow).not.toBeNull();
    expect(
      await within(hiddenRow!).findByLabelText("Agent is waiting for your input"),
    ).toBeVisible();

    fireEvent.click(within(hiddenRow!).getByRole("button", { name: "Restore Bravo" }));

    await waitFor(() => expect(tabNames()).toEqual(["Bravo"]));
    expect(useClientStore.getState().selectedModuleId).toBeNull();
    expect(manager).toBeVisible();
    expect(mutationCalls).toContainEqual({
      moduleId: "module-b",
      tabHidden: false,
    });
    expect(screen.getByRole("button", { name: "Close Module Manager", expanded: true })).toBeVisible();
    const openRow = document.querySelector<HTMLElement>('li[data-module-manager-row="module-b"]')!;
    fireEvent.click(within(openRow).getByRole("button", { name: "Open Bravo" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
    expect(useClientStore.getState().selectedModuleId).toBe("module-b");
    expect(screen.getByRole("tab", { name: "Bravo" })).toBeVisible();
  });

  it("keeps a focused hidden manager module hidden when Enter inspects it", async () => {
    hiddenIds = new Set(["module-b"]);
    function ManagerKeyboard() { useGlobalKeymap(); return null; }
    openModuleManager();
    render(<><ManagerKeyboard /><ModuleManager /><ModuleTabStrip /></>);
    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Charlie"]));
    const inspect = screen.getByRole("button", { name: "Inspect Bravo" });
    inspect.focus();
    fireEvent.keyDown(inspect, { key: "Enter" });
    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Charlie"]));
    expect(mutationCalls).toEqual([]);
    expect(useClientStore.getState().selectedModuleId).toBeNull();
    expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  });

  it("selects the nearest visible tab to the right, then the left", async () => {
    const links = MODULES.map((module) => ({
      id: `link-${module.id}`,
      moduleId: module.id,
      path: `/repos/${module.id}`,
    }));
    seedModuleLinks(links);
    useClientStore.setState({ selectedModuleId: "module-b" });
    const view = render(<ModuleTabStrip />);
    await waitFor(() => expect(tabNames()).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Hide Bravo tab" }));
    expect(useClientStore.getState().selectModule).toHaveBeenLastCalledWith("module-c", { isCurrent: expect.any(Function) });
    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Charlie"]));

    view.unmount();
    await resetStudioApolloClient();
    setStorySprintFilterIntent(PROJECT_ID, { mode: "all" });
    seedModuleLinks(links);
    hiddenIds = new Set();
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    const selectModule = vi.fn(async (moduleId: string) => {
      useClientStore.setState({ selectedModuleId: moduleId });
    });
    useClientStore.setState({ selectedModuleId: "module-c", selectModule });
    render(<ModuleTabStrip />);
    await waitFor(() => expect(tabNames()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Hide Charlie tab" }));

    expect(selectModule).toHaveBeenLastCalledWith("module-b", expect.objectContaining({ isCurrent: expect.any(Function) }));
  });

  it("clears selection and the remembered module when the last visible tab is hidden", async () => {
    hiddenIds = new Set(["module-b", "module-c"]);
    useClientStore.setState({ selectedModuleId: "module-a" });
    localStorage.setItem(RECENT_MODULE_KEY, "module-a");
    render(<ModuleTabStrip />);
    await waitFor(() => expect(tabNames()).toEqual(["Alpha"]));

    fireEvent.click(screen.getByRole("button", { name: "Hide Alpha tab" }));

    await waitFor(() => expect(tabNames()).toEqual([]));
    expect(useClientStore.getState().selectedModuleId).toBeNull();
    expect(localStorage.getItem(RECENT_MODULE_KEY)).toBeNull();
  });

  it("rolls back a failed hide without changing another tab's selection", async () => {
    failNextVisibility = true;
    useClientStore.setState({ selectedModuleId: "module-a" });
    render(<ModuleTabStrip />);
    await waitFor(() => expect(tabNames()).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Hide Charlie tab" }));
    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Bravo"]));
    await waitFor(() => expect(tabNames()).toEqual(["Alpha", "Bravo", "Charlie"]));

    expect(useClientStore.getState().selectedModuleId).toBe("module-a");
    expect(useClientStore.getState().selectModule).not.toHaveBeenCalled();
    expect(useClientStore.getState().toasts.at(-1)?.message).toContain(
      "Module tab could not be hidden",
    );
  });
});
