import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import type {
  ScratchRow,
  TreeRow,
  WorkItemRow,
} from "../app/shell/ticket-workspace/tasks/TasksPane";
import { TEMP_TASK_ID } from "../features/agents/types";
import { scratchBucketId } from "../features/agents/terminal";
import { useStudioStore } from "../features/projects/store";
import { useAgentStatusStore } from "../features/agents/status";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { setStatesSorted } from "../shared/query/stateCatalog";
import { useClientStore, type EditViewZone } from "../state/clientStore";
import { workItem } from "./seam";

const terminalApi = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  getTerminals: vi.fn(),
  listResumableTerminals: vi.fn(),
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({
    SelectedTicketTerminal: ({ bucket }: { bucket: string }) => (
      <div className="xterm" data-testid="selected-ticket-terminal">
        <textarea aria-label="Terminal input" defaultValue={bucket} />
      </div>
    ),
  }),
);

const TODO = {
  id: "todo",
  name: "Todo",
  group: "backlog",
  color: null,
  sort_order: 0,
};

const PARENT_ROW: WorkItemRow = {
  kind: "work-item",
  id: "story-1",
  depth: 0,
  parentId: null,
  expandable: true,
  expanded: false,
};

const EXPANDED_ROWS: WorkItemRow[] = [
  { ...PARENT_ROW, expanded: true },
  {
    kind: "work-item",
    id: "child-1",
    depth: 1,
    parentId: "story-1",
    expandable: false,
    expanded: false,
  },
];

/** The Local scratch workspace row: selectable in Stories, never expandable. */
const SCRATCH_ROW: ScratchRow = { kind: "scratch", moduleId: "module-1" };

function session(): SessionMeta {
  return {
    sessionId: "session-1",
    taskId: "story-1",
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    status: "ready",
    transport: "ready",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId: "run-1",
  };
}

function KeymapHarness({ rows }: { rows: TreeRow[] }) {
  useGlobalKeymap(rows);
  return null;
}

function press(
  key: string,
  modifiers: { shiftKey?: boolean; metaKey?: boolean } = {},
): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      }),
    );
  });
}

function recordZones(): EditViewZone[] {
  const seen: EditViewZone[] = [];
  useClientStore.subscribe((state, previous) => {
    if (state.editViewZone !== previous.editViewZone) {
      seen.push(state.editViewZone);
    }
  });
  return seen;
}

function bodyElement(): HTMLElement {
  const body = document.querySelector<HTMLElement>(
    '[data-navigation-zone="active-tab-body"]',
  );
  if (!body) throw new Error("Active tab body is not rendered");
  return body;
}

async function renderEditViewWorkspace(
  rows: WorkItemRow[],
): Promise<{ setRows: (next: WorkItemRow[]) => void }> {
  function tree(current: WorkItemRow[]) {
    return (
      <QueryClientProvider client={queryClient}>
        <KeymapHarness rows={current} />
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Details surface</div>}
        />
      </QueryClientProvider>
    );
  }

  const view = render(tree(rows));
  await waitFor(() => {
    expect(screen.getByRole("tab", { name: "codex terminal" })).toBeTruthy();
  });
  return {
    setRows: (next) => {
      act(() => {
        view.rerender(tree(next));
      });
    },
  };
}

/**
 * Mounts the scratch workspace the way the shell does when the Local scratch
 * workspace row is selected: its own bucket, no launch context, and only the
 * pinned Details tab.
 */
async function renderScratchWorkspace(): Promise<void> {
  useClientStore.setState({ selectedTaskId: TEMP_TASK_ID });
  render(
    <QueryClientProvider client={queryClient}>
      <KeymapHarness rows={[SCRATCH_ROW]} />
      <SelectedTicketContent
        bucket={scratchBucketId("module-1")}
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<div>Details surface</div>}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(screen.getByRole("tab", { name: "Details" })).toBeTruthy();
  });
}

describe("overhaul acceptance — Edit view navigation zones", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    queryClient.clear();
    seedConfig({ features: { sidebar: true, projects: true } });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: "story-1",
      focusedPane: "tasks",
      // Edit view is the sidebar-hidden, three-zone keyboard model.
      sidebarVisible: false,
      editViewZone: "stories",
      editViewBodyEngaged: false,
      navigationModality: "keyboard",
      storySearchQuery: "",
      collapsedStateIds: new Set<string>(),
      expandedIdsByModule: {},
      // The remembered Active tab for this Story is its terminal.
      workspaces: {
        "story-1": { active: "terminal", activeDocId: null, closedDocIds: [] },
      },
      activeByTask: { "story-1": "session-1" },
      toasts: [],
    });
    useTerminalStore.setState({
      sessions: { "session-1": session() },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {
        "run-1": {
          agent_run_id: "run-1",
          task_id: "story-1",
          module_id: "module-1",
          scope: "task",
          state: "working",
          started_at: "2026-08-07T12:00:00Z",
          updated_at: "2026-08-07T12:00:00Z",
        },
      },
      automationAttempts: {},
      automationByTask: {},
    });

    const parent = workItem({
      id: "story-1",
      name: "Parent",
      state: TODO.id,
      rank: "Z",
      sub_issues_count: 1,
    });
    const child = workItem({
      id: "child-1",
      name: "Child",
      key: "MEML-2",
      state: TODO.id,
      parent_id: "story-1",
      rank: "A",
    });
    queryClient.setQueryData(queryKeys.tasks.byModule("project-1", "module-1"), {
      rootIds: ["story-1"],
      children: { "story-1": ["child-1"], "child-1": [] },
      order: ["story-1", "child-1"],
    });
    queryClient.setQueryData(queryKeys.workItems.byId(parent.id), parent);
    queryClient.setQueryData(queryKeys.workItems.byId(child.id), child);
    setStatesSorted("project-1", [TODO]);

    terminalApi.getDocuments.mockResolvedValue({ documents: [] });
    terminalApi.getTerminals.mockResolvedValue([]);
    terminalApi.listResumableTerminals.mockResolvedValue([]);
  });

  it("[overhaul-82] expands a collapsed Story on Right, then dives Right straight into its remembered Active tab body", async () => {
    const { setRows } = await renderEditViewWorkspace([PARENT_ROW]);
    const zones = recordZones();

    press("ArrowRight");

    expect(useClientStore.getState().expandedIdsByModule["module-1"]).toContain(
      "story-1",
    );
    expect(useClientStore.getState().editViewZone).toBe("stories");
    expect(zones).toEqual([]);

    // Nothing left to expand: Right dives instead of stopping at the tab strip.
    setRows(EXPANDED_ROWS);
    press("ArrowRight");

    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");
    expect(zones).toEqual(["active-tab-body"]);
    expect(zones).not.toContain("tab-strip");
    expect(useClientStore.getState().workspaces["story-1"]?.active).toBe(
      "terminal",
    );
    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.activeElement).toBe(bodyElement());
    // A dive selects the body without engaging its content, exactly like Enter.
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
  });

  it("lands Right where Enter lands", async () => {
    await renderEditViewWorkspace(EXPANDED_ROWS);

    press("ArrowRight");
    const afterRight = {
      zone: useClientStore.getState().editViewZone,
      engaged: useClientStore.getState().editViewBodyEngaged,
      active: useClientStore.getState().workspaces["story-1"]?.active,
      focused: document.activeElement,
    };

    useClientStore.getState().setEditViewZone("stories");
    press("Enter");

    expect({
      zone: useClientStore.getState().editViewZone,
      engaged: useClientStore.getState().editViewBodyEngaged,
      active: useClientStore.getState().workspaces["story-1"]?.active,
      focused: document.activeElement,
    }).toEqual(afterRight);
  });

  it("lands Right where Enter lands on the scratch workspace row", async () => {
    await renderScratchWorkspace();

    // The scratch row has nothing to expand, so Right dives immediately.
    press("ArrowRight");
    const afterRight = {
      zone: useClientStore.getState().editViewZone,
      engaged: useClientStore.getState().editViewBodyEngaged,
      focused: document.activeElement,
    };

    expect(afterRight.zone).toBe("active-tab-body");
    expect(afterRight.engaged).toBe(false);
    expect(afterRight.focused).toBe(bodyElement());

    useClientStore.getState().setEditViewZone("stories");
    press("Enter");

    expect({
      zone: useClientStore.getState().editViewZone,
      engaged: useClientStore.getState().editViewBodyEngaged,
      focused: document.activeElement,
    }).toEqual(afterRight);
  });

  it("keeps Right in the Stories zone when no navigable Task workspace is mounted", () => {
    render(<KeymapHarness rows={EXPANDED_ROWS} />);
    const zones = recordZones();

    press("ArrowRight");

    expect(useClientStore.getState().editViewZone).toBe("stories");
    expect(zones).toEqual([]);
  });

  it("preserves the established routes out of the Active tab body and around the zones", async () => {
    await renderEditViewWorkspace(EXPANDED_ROWS);

    press("ArrowRight");
    press("ArrowUp");
    expect(useClientStore.getState().editViewZone).toBe("tab-strip");

    press("ArrowDown");
    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");

    press("ArrowLeft");
    expect(useClientStore.getState().editViewZone).toBe("stories");

    // Left in the Stories zone still collapses the tree.
    press("ArrowLeft");
    expect(
      useClientStore.getState().expandedIdsByModule["module-1"] ?? [],
    ).not.toContain("story-1");

    press("Tab", { shiftKey: true });
    expect(useClientStore.getState().editViewZone).toBe("tab-strip");
    press("Tab", { shiftKey: true });
    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");
    press("Tab", { shiftKey: true });
    expect(useClientStore.getState().editViewZone).toBe("stories");
  });

  it("leaves an engaged terminal owning its keys until Cmd+Escape", async () => {
    await renderEditViewWorkspace(EXPANDED_ROWS);

    press("ArrowRight");
    press("Enter");
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);

    press("ArrowLeft");
    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);

    press("Escape", { metaKey: true });
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");
  });

  it("leaves Full sidebar view pane navigation unchanged", async () => {
    useClientStore.setState({ sidebarVisible: true });
    await renderEditViewWorkspace(EXPANDED_ROWS);
    const zones = recordZones();

    press("ArrowRight");

    expect(useClientStore.getState().selectedTaskId).toBe("child-1");
    expect(useClientStore.getState().focusedPane).toBe("tasks");
    expect(zones).toEqual([]);
  });
});
