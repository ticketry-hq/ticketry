import { QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import {
  PanelGroup,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return {
    ...actual,
    listModulePresentations: vi.fn(),
    listModules: vi.fn(),
    listProjects: vi.fn(),
    getTasks: vi.fn(),
    reorderModulePresentation: vi.fn(),
    updateModulePresentation: vi.fn(),
  };
});

vi.mock("../features/terminal-panel", () => ({
  FooterTerminalToggle: () => <button type="button">Terminal</button>,
  TerminalPanel: () => null,
}));

import { useAgentStatusStore } from "../features/agents/status";
import { selectModuleAtPosition } from "../app/navigation/sharedNavigation";
import { routeFullSidebarViewFocusedPaneNavigation } from "../app/navigation/full-sidebar-view/fullSidebarViewNavigation";
import { StudioFooter } from "../app/shell/StudioFooter";
import { DEFAULT_PANEL_LAYOUT } from "../app/shell/layout/layoutMath";
import { StudioSidebar } from "../app/shell/sidebar/StudioSidebar";
import { useRestoreAndSelectModule } from "../features/module-tabs";
import { TicketWorkspace } from "../app/shell/ticket-workspace/TicketWorkspace";
import { seedModuleLinks } from "../features/module-links";
import { getModulesSnapshot } from "../features/projects";
import { useStudioStore } from "../features/projects/store";
import * as api from "../shared/api/client";
import type { ModulePresentation } from "../shared/api/types";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";
import { LAST_SELECTED_MODULE_KEY } from "../state/persistence";
import { dragTab } from "./moduleDragGestures";
import {
  backlogGroupOrder,
  deferred,
  listModulePresentations,
  listModules,
  modules,
  renderAutomaticProject,
  reorderModulePresentation,
  resetModuleReorderHarness,
  rowFor,
  sidebarOrder,
  tabFor,
  tabStripOrder,
  updateModulePresentation,
} from "./moduleReorderHarness";

function presentation(moduleId: string, tabHidden: boolean): ModulePresentation {
  return { module_id: moduleId, rank: "middle", tab_hidden: tabHidden };
}

function rowBadges(moduleId: string): string[] {
  return Array.from(
    rowFor(moduleId).querySelectorAll<HTMLElement>("span[aria-label]"),
  ).map((badge) => badge.getAttribute("aria-label") ?? "");
}

const defaultSelectModule = useClientStore.getState().selectModule;

function HiddenModuleRecoveryShell() {
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);

  return (
    <QueryClientProvider client={queryClient}>
      {sidebarVisible ? (
        <PanelGroup direction="horizontal">
          <StudioSidebar layout={DEFAULT_PANEL_LAYOUT} />
        </PanelGroup>
      ) : null}
      <TicketWorkspace
        tasksSize={40}
        workspaceSize={60}
        groupRef={createRef<ImperativePanelGroupHandle>()}
        onLayout={() => {}}
      />
      <StudioFooter />
    </QueryClientProvider>
  );
}

describe("module tab visibility acceptance", () => {
  beforeEach(() => {
    resetModuleReorderHarness();
    useClientStore.setState({ selectModule: defaultSelectModule });
  });

  it("[overhaul-165] recovers an all-hidden workspace through the Modules pane", async () => {
    const hiddenIds = new Set(["module-a", "module-b", "module-c"]);
    listModules.mockResolvedValue(modules("module-a", "module-b", "module-c"));
    listModulePresentations.mockImplementation(async () =>
      [...hiddenIds].map((moduleId) => presentation(moduleId, true)),
    );
    updateModulePresentation.mockImplementation(
      async (moduleId: string, body: { tab_hidden: boolean }) => {
        if (body.tab_hidden) hiddenIds.add(moduleId);
        else hiddenIds.delete(moduleId);
        return presentation(moduleId, body.tab_hidden);
      },
    );
    const selectModule = vi.fn(async (moduleId: string) => {
      useClientStore.setState({ selectedModuleId: moduleId });
    });
    useClientStore.setState({
      selectedModuleId: null,
      selectModule,
      sidebarVisible: false,
    });

    render(<HiddenModuleRecoveryShell />);

    expect(
      await screen.findByText(
        "Open the Modules sidebar to restore a module tab.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open module picker" }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Open Modules pane" }),
    );
    expect(await screen.findByTestId("pane-modules")).toBeVisible();
    expect(screen.getByTestId("empty-module-workspace")).toHaveTextContent(
      "Select a module in the Modules pane to restore its tab.",
    );
    expect(
      screen.queryByText("Open the Modules sidebar to restore a module tab."),
    ).not.toBeInTheDocument();

    fireEvent.click(rowFor("module-c"));
    await waitFor(() => expect(tabStripOrder()).toEqual(["C"]));
    fireEvent.click(rowFor("module-a"));
    await waitFor(() => expect(tabStripOrder()).toEqual(["A", "C"]));
    fireEvent.click(rowFor("module-b"));

    await waitFor(() => expect(tabStripOrder()).toEqual(["A", "B", "C"]));
    expect(selectModule).toHaveBeenLastCalledWith("module-b");
    expect(tabFor("module-b")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(
      screen.getByRole("button", { name: "Close Modules pane" }),
    );
    expect(screen.queryByTestId("pane-modules")).not.toBeInTheDocument();
    expect(tabStripOrder()).toEqual(["A", "B", "C"]);
    expect(tabFor("module-b")).toHaveAttribute("aria-selected", "true");
    expect(hiddenIds).toEqual(new Set());
  });

  it("[overhaul-162] skips a hidden remembered module on startup and selects the first visible tab", async () => {
    listModulePresentations.mockResolvedValue([
      presentation("module-b", true),
    ]);
    listModules.mockResolvedValue(modules("module-a", "module-b", "module-c"));
    vi.mocked(api.getTasks).mockResolvedValue({
      rootIds: [],
      children: {},
      order: [],
      states: [],
      workItems: [],
    });
    seedModuleLinks([
      {
        id: "link-a",
        module_id: "module-a",
        local_path: "/repos/module-a",
        created_at: "",
        updated_at: "",
      },
    ]);
    localStorage.setItem(LAST_SELECTED_MODULE_KEY, "module-b");
    useStudioStore.setState({ selectedProjectId: null, error: null });

    await useStudioStore.getState().selectProject("project-1");

    expect(useClientStore.getState().selectedModuleId).toBe("module-a");
    expect(localStorage.getItem(LAST_SELECTED_MODULE_KEY)).toBe("module-a");
    expect(api.getTasks).toHaveBeenCalledWith("project-1", "module-a");
  });

  it("[overhaul-150] shares selection while writing presentation state only to restore a hidden tab", async () => {
    listModulePresentations
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([presentation("module-b", true)])
      .mockResolvedValue([presentation("module-b", false)]);
    updateModulePresentation.mockImplementation(
      async (moduleId: string, body: { tab_hidden: boolean }) =>
        presentation(moduleId, body.tab_hidden),
    );
    const selectModule = vi.fn(async () => {});
    useClientStore.setState({ selectModule });
    await renderAutomaticProject();

    fireEvent.click(rowFor("module-c"));
    expect(selectModule).toHaveBeenCalledWith("module-c");
    expect(updateModulePresentation).not.toHaveBeenCalled();
    expect(reorderModulePresentation).not.toHaveBeenCalled();
    selectModule.mockClear();

    const tab = tabFor("module-b");
    const hide = screen.getByRole("button", { name: "Hide B tab" });
    expect(tab.contains(hide)).toBe(false);
    expect(hide).toHaveAttribute("title", "Hide tab");
    expect(hide.className).not.toMatch(/danger|destructive|red/);

    fireEvent.click(hide);

    await waitFor(() =>
      expect(updateModulePresentation).toHaveBeenCalledWith("module-b", {
        tab_hidden: true,
      }),
    );
    expect(tabStripOrder()).toEqual(["A", "C"]);
    expect(sidebarOrder()).toEqual(["module-a", "module-b", "module-c"]);
    expect(backlogGroupOrder()).toEqual(["A", "B", "C"]);
    expect(getModulesSnapshot("project-1").map((module) => module.id)).toEqual([
      "module-a",
      "module-b",
      "module-c",
    ]);

    fireEvent.click(rowFor("module-b"));

    expect(selectModule).toHaveBeenCalledWith("module-b");
    await waitFor(() =>
      expect(updateModulePresentation).toHaveBeenLastCalledWith("module-b", {
        tab_hidden: false,
      }),
    );
    await waitFor(() => expect(tabStripOrder()).toEqual(["A", "B", "C"]));
    expect(reorderModulePresentation).not.toHaveBeenCalled();
  });

  it("[overhaul-163] restores a hidden module tab when Enter activates its sidebar row", async () => {
    listModulePresentations
      .mockResolvedValueOnce([presentation("module-b", true)])
      .mockResolvedValue([presentation("module-b", false)]);
    const selectModule = vi.fn(async () => {});
    useClientStore.setState({
      focusedPane: "modules",
      modulesCursorId: "module-b",
      selectModule,
      sidebarVisible: true,
    });
    await renderAutomaticProject();
    await waitFor(() => expect(tabStripOrder()).toEqual(["A", "C"]));
    const restoreAndSelectModule = renderHook(() =>
      useRestoreAndSelectModule(),
    );
    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "Enter",
    });

    expect(
      routeFullSidebarViewFocusedPaneNavigation(
        event,
        [],
        "modules.activate",
        restoreAndSelectModule.result.current,
      ),
    ).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(selectModule).toHaveBeenCalledWith("module-b");
    await waitFor(() =>
      expect(updateModulePresentation).toHaveBeenCalledWith("module-b", {
        tab_hidden: false,
      }),
    );
    await waitFor(() => expect(tabStripOrder()).toEqual(["A", "B", "C"]));
  });

  it("[overhaul-151] keeps hidden tabs closed during agent activity and shows that activity in the sidebar", async () => {
    listModulePresentations.mockResolvedValue([
      presentation("module-b", true),
    ]);
    await renderAutomaticProject();
    await waitFor(() => expect(tabStripOrder()).toEqual(["A", "C"]));

    useAgentStatusStore.setState({
      runs: {
        "run-1": { module_id: "module-b", state: "needs_input" },
      } as unknown as ReturnType<typeof useAgentStatusStore.getState>["runs"],
    });

    await waitFor(() =>
      expect(rowBadges("module-b")).toEqual(["Agent is waiting for your input"]),
    );
    expect(tabStripOrder()).toEqual(["A", "C"]);
    expect(updateModulePresentation).not.toHaveBeenCalled();
  });

  it("[overhaul-152] selects the nearest visible tab to the right", async () => {
    const selectModule = vi.fn(async () => {});
    useClientStore.setState({ selectedModuleId: "module-b", selectModule });
    await renderAutomaticProject();

    fireEvent.click(screen.getByRole("button", { name: "Hide B tab" }));
    expect(selectModule).toHaveBeenLastCalledWith("module-c");
  });

  it("[overhaul-157] falls back to the nearest visible tab on the left", async () => {
    const selectModule = vi.fn(async () => {});
    useClientStore.setState({ selectedModuleId: "module-c", selectModule });
    await renderAutomaticProject();

    fireEvent.click(screen.getByRole("button", { name: "Hide C tab" }));
    expect(selectModule).toHaveBeenLastCalledWith("module-b");
  });

  it("[overhaul-158] does not change selection when another tab is hidden", async () => {
    const selectModule = vi.fn(async () => {});
    useClientStore.setState({ selectedModuleId: "module-a", selectModule });
    await renderAutomaticProject();

    fireEvent.click(screen.getByRole("button", { name: "Hide C tab" }));
    expect(selectModule).not.toHaveBeenCalled();
    expect(useClientStore.getState().selectedModuleId).toBe("module-a");
  });

  it("[overhaul-155] keeps module creation available and points an empty workspace to the Modules sidebar", async () => {
    const hiddenIds = new Set(["module-b", "module-c"]);
    listModulePresentations.mockImplementation(async () =>
      [...hiddenIds].map((moduleId) => presentation(moduleId, true)),
    );
    updateModulePresentation.mockImplementation(
      async (moduleId: string, body: { tab_hidden: boolean }) => {
        if (body.tab_hidden) hiddenIds.add(moduleId);
        else hiddenIds.delete(moduleId);
        return presentation(moduleId, body.tab_hidden);
      },
    );
    useClientStore.setState({ selectedModuleId: "module-a" });
    localStorage.setItem(LAST_SELECTED_MODULE_KEY, "module-a");
    await renderAutomaticProject();

    fireEvent.click(screen.getByRole("button", { name: "Hide A tab" }));
    await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
    expect(
      screen.getByRole("button", { name: "Open module picker" }),
    ).toBeVisible();
    expect(useClientStore.getState().selectedModuleId).toBeNull();
    expect(localStorage.getItem(LAST_SELECTED_MODULE_KEY)).toBeNull();

    useClientStore.setState({ sidebarVisible: false });
    render(
      <QueryClientProvider client={queryClient}>
        <TicketWorkspace
          tasksSize={40}
          workspaceSize={60}
          groupRef={createRef<ImperativePanelGroupHandle>()}
          onLayout={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("empty-module-workspace")).toHaveTextContent(
      "Open the Modules sidebar to restore a module tab.",
    );
  });

  it("[overhaul-161] keeps the workspace mounted when the project has no modules", async () => {
    const modulesRequest = deferred<ReturnType<typeof modules>>();
    listModules.mockReturnValue(modulesRequest.promise);

    render(
      <QueryClientProvider client={queryClient}>
        <TicketWorkspace
          tasksSize={40}
          workspaceSize={60}
          groupRef={createRef<ImperativePanelGroupHandle>()}
          onLayout={() => {}}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(listModules).toHaveBeenCalled());
    await act(async () => {
      modulesRequest.resolve([]);
      await modulesRequest.promise;
    });
    expect(screen.queryByTestId("empty-module-workspace")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Capture an idea" })).toBeVisible();
    expect(screen.getByText("No task selected")).toBeVisible();
  });

  it("[overhaul-156] numbers keyboard shortcuts over visible tabs only", async () => {
    listModulePresentations.mockResolvedValue([
      presentation("module-b", true),
    ]);
    const selectModule = vi.fn(async () => {});
    useClientStore.setState({ selectedModuleId: "module-a", selectModule });
    await renderAutomaticProject();

    expect(selectModuleAtPosition(2)).toBe(true);
    expect(selectModule).toHaveBeenCalledWith("module-c");
    expect(selectModuleAtPosition(3)).toBe(false);
    expect(selectModule).not.toHaveBeenCalledWith("module-b");
  });

  it("[overhaul-159] keeps hidden modules in canonical order while visible tabs reorder", async () => {
    listModulePresentations.mockResolvedValue([
      presentation("module-b", true),
    ]);
    await renderAutomaticProject();
    listModules.mockResolvedValue(
      modules("module-b", "module-c", "module-a"),
    );

    dragTab("module-a", "module-c", "far");

    await waitFor(() =>
      expect(reorderModulePresentation).toHaveBeenCalledWith("module-a", {
        before_id: "module-c",
        after_id: null,
        initial_order_ids: ["module-a", "module-b", "module-c"],
      }),
    );
    expect(tabStripOrder()).toEqual(["C", "A"]);
    expect(sidebarOrder()).toEqual(["module-b", "module-c", "module-a"]);

    fireEvent.click(rowFor("module-b"));
    await waitFor(() => expect(tabStripOrder()).toEqual(["B", "C", "A"]));
  });
});
