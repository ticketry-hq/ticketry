import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalStore, type SessionMeta } from "../features/agents/terminal";
import { GeneratedWorkTrackerWorkItemFieldsFragmentDoc } from "../features/work-items/generated/workItems.documents";
import { studioApolloClient } from "../shared/apollo/client";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";
import { seedModuleOpenFixture } from "./projectOpenFixture";
import { workItem } from "./seam";
import type { WorkspaceTabIdentity } from "../features/workspace-tabs/types";

const WORK_ITEM_ID = "8f6aee39-ade4-41ff-9d4c-26f8a504f8de";

const documentRegistry = vi.hoisted(() => ({
  listTaskDocuments: vi.fn(),
  listScratchDocuments: vi.fn(),
}));
const saves = vi.hoisted(() => vi.fn());

vi.mock("../features/documents/documentRegistry", () => documentRegistry);

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({ SelectedTicketTerminal: () => <div /> }),
);

const terminalReads = {
  readTaskTerminalSessions: vi.fn(),
  readScratchTerminalSessions: vi.fn(),
  readTaskResumableTerminalSessions: vi.fn(),
  readScratchResumableTerminalSessions: vi.fn(),
};

const terminal: SessionMeta = {
  sessionId: "viewer-1",
  taskId: WORK_ITEM_ID,
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

function run(agentRunId: string, agent = "codex") {
  return {
    agent_run_id: agentRunId,
    task_id: WORK_ITEM_ID,
    module_id: "module-1",
    agent,
    scope: "task" as const,
    state: "working" as const,
    started_at: "2026-08-29T12:00:00Z",
    updated_at: "2026-08-29T12:00:00Z",
  };
}

/** Null until a case opts the Changes tab in; the tab needs a live worktree. */
let worktreeStatus: unknown = null;

const activeCleanWorktree = {
  __typename: "WorktreeStatusView",
  kind: "worktree",
  task_id: WORK_ITEM_ID,
  top_level_task_id: WORK_ITEM_ID,
  is_shared: false,
  branch: "wt/CODING-1952-gesture-aware-activation",
  base_branch: "main",
  path: "/worktrees/CODING-1952",
  state: "active",
  clean: true,
  dirty: false,
  ahead: 0,
  behind: 0,
  conflict: false,
  checkout_present: true,
  ephemeral: false,
  reason: null,
};

const emptyChanges = {
  __typename: "WorktreeChangesView",
  task_id: WORK_ITEM_ID,
  top_level_task_id: WORK_ITEM_ID,
  is_shared: false,
  base_commit: "0123456789abcdef0123456789abcdef01234567",
  committed_count: 0,
  pull_request_url: null,
  pull_request_creation_eligible: false,
  work_item_done: false,
  closure_failure: null,
  cleanup: {
    __typename: "WorktreeCleanupStatusView",
    eligible: false,
    blocker: "pull_request_absent",
    reason: "No pull request is mapped to this worktree.",
  },
  pull_request: {
    __typename: "PullRequestStatusView",
    url: null,
    state: "none",
    target_branch: null,
    head_commit: null,
    integrated: false,
    post_merge_work: false,
    replacement_eligible: false,
    follow_up_eligible: false,
    merge_preparation_eligible: false,
    reason: null,
  },
  clean: true,
  dirty: false,
  unpushed_count: 0,
  truncated: false,
  files: [],
  insertions: 0,
  deletions: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function currentIssue(order: readonly WorkspaceTabIdentity[]) {
  const row = studioApolloClient().readFragment({
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    from: {
      __typename: "WorktrackerIssue",
      id: compactWorktrackerId(WORK_ITEM_ID),
    },
    optimistic: false,
  });
  if (!row) throw new Error("Workspace fixture row is missing.");
  return { ...row, workspace_tab_order: order };
}

function installRuntime(): void {
  const terminalExecutor = terminalSessionReadExecutor(terminalReads);
  installDesktopGraphQlRuntime(async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "WorktreeStatus") {
      return { worktree_status: worktreeStatus } as never;
    }
    if (operation === "WorktreeChanges") {
      return { worktree_changes: emptyChanges } as never;
    }
    if (operation === "CurrentWorktrees") {
      return { worktrees: { __typename: "WorktreeConnection", nodes: [] } } as never;
    }
    if (operation === "UpdateWorkTrackerWorkspaceTabOrder") {
      const order = (variables as { workspaceTabOrder: WorkspaceTabIdentity[] })
        .workspaceTabOrder;
      const saved = await saves(order);
      return { update_work_item: currentIssue(saved) } as never;
    }
    return terminalExecutor(document, variables);
  });
}

function seedSavedOrder(order: readonly WorkspaceTabIdentity[]): void {
  seedModuleOpenFixture("module-1", [workItem({ id: WORK_ITEM_ID })]);
  studioApolloClient().cache.modify({
    id: studioApolloClient().cache.identify({
      __typename: "WorktrackerIssue",
      id: compactWorktrackerId(WORK_ITEM_ID),
    }),
    fields: { workspaceTabOrder: () => order },
  });
}

function mountWorkspace() {
  return render(
    <StudioApolloProvider>
      <SelectedTicketContent
        bucket={WORK_ITEM_ID}
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<div>Issue details</div>}
      />
    </StudioApolloProvider>,
  );
}

function visibleTabNames(): string[] {
  return within(screen.getByTestId("workspace-tabs"))
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("aria-label") ?? "");
}

function workspaceTab(name: string): HTMLElement {
  return screen.getByRole("tab", { name });
}

function dataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    get types() { return [...values.keys()]; },
    clearData: (type?: string) => type ? values.delete(type) : values.clear(),
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
    setDragImage: () => undefined,
  };
}

function dispatchDrag(
  target: Element,
  type: string,
  transfer: DataTransfer,
  clientX = 0,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientX: { value: clientX },
  });
  fireEvent(target, event);
}

function beginDrag(
  sourceName: string,
  targetName: string,
  intent: "near" | "far",
): DataTransfer {
  const tabs = within(screen.getByTestId("workspace-tabs")).getAllByRole("tab");
  tabs.forEach((element, index) => {
    const left = index * 100;
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 0,
        bottom: 28,
        height: 28,
        left,
        right: left + 100,
        width: 100,
      }),
    });
  });
  const source = workspaceTab(sourceName);
  const target = workspaceTab(targetName);
  const rect = target.getBoundingClientRect();
  const clientX = intent === "near" ? rect.left + 2 : rect.right - 2;
  const transfer = dataTransfer();
  dispatchDrag(source, "dragstart", transfer);
  dispatchDrag(target, "dragover", transfer, clientX);
  return transfer;
}

function dropOn(targetName: string, transfer: DataTransfer): void {
  dispatchDrag(workspaceTab(targetName), "drop", transfer);
}

describe("overhaul acceptance, server-owned workspace tab order", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    worktreeStatus = null;
    installRuntime();
    Element.prototype.scrollIntoView = vi.fn();
    documentRegistry.listTaskDocuments.mockResolvedValue([
      { id: "design", rel_path: "DESIGN.md", content_digest: null },
      { id: "notes", rel_path: "NOTES.md", content_digest: null },
    ]);
    documentRegistry.listScratchDocuments.mockResolvedValue([]);
    terminalReads.readTaskTerminalSessions.mockResolvedValue([{
      agent_run_id: "run-1",
      created_at: "2026-08-29T12:00:00Z",
      launch_state: null,
      launch_model: null,
    }]);
    terminalReads.readScratchTerminalSessions.mockResolvedValue([]);
    terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([]);
    terminalReads.readScratchResumableTerminalSessions.mockResolvedValue([]);
    saves.mockImplementation(async (order) => order);
    useClientStore.setState({
      sidebarVisible: true,
      workspaces: {},
      activeByTask: {},
      toasts: [],
    });
    useTerminalStore.setState({
      sessions: { "viewer-1": terminal },
      sessionByRun: { "run-1": "viewer-1" },
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: { "run-1": run("run-1") },
      automationAttempts: {},
      automationByTask: {},
    });
  });

  it("[overhaul-171] restores mixed order, hidden tabs, and newly visible tabs", async () => {
    seedSavedOrder([
      { kind: "terminal", id: "run-1" },
      { kind: "details" },
      { kind: "doc", id: "design" },
      { kind: "doc", id: "notes" },
    ]);
    const first = mountWorkspace();
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "DESIGN",
      "NOTES",
    ]));

    fireEvent.click(screen.getByRole("button", { name: "Close DESIGN" }));
    expect(visibleTabNames()).toEqual(["codex terminal", "Details", "NOTES"]);
    fireEvent.click(screen.getByRole("button", { name: "Reopen DESIGN" }));
    expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "DESIGN",
      "NOTES",
    ]);

    act(() => {
      useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
      useAgentStatusStore.setState({ runs: {} });
    });
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "Details",
      "DESIGN",
      "NOTES",
    ]));
    act(() => useTerminalStore.setState({
      sessions: { "viewer-1": terminal },
      sessionByRun: { "run-1": "viewer-1" },
    }));
    act(() => useAgentStatusStore.setState({ runs: { "run-1": run("run-1") } }));
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "DESIGN",
      "NOTES",
    ]));

    first.unmount();
    mountWorkspace();
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "DESIGN",
      "NOTES",
    ]));

    const secondTerminal: SessionMeta = {
      ...terminal,
      sessionId: "viewer-2",
      agentRunId: "run-2",
      agent: "claude",
    };
    act(() => {
      useTerminalStore.setState((state) => ({
        sessions: { ...state.sessions, "viewer-2": secondTerminal },
        sessionByRun: { ...state.sessionByRun, "run-2": "viewer-2" },
      }));
      useAgentStatusStore.setState({
        runs: {
          ...useAgentStatusStore.getState().runs,
          "run-2": run("run-2", "claude"),
        },
      });
    });

    await waitFor(() => expect(visibleTabNames().at(-1)).toBe("claude terminal"));
    await waitFor(() => expect(saves).toHaveBeenCalledWith([
      { kind: "terminal", id: "run-1" },
      { kind: "details" },
      { kind: "doc", id: "design" },
      { kind: "doc", id: "notes" },
      { kind: "terminal", id: "run-2" },
    ]));
  });

  it("[overhaul-172] drags with a seam, pending lock, click suppression, and rollback", async () => {
    worktreeStatus = activeCleanWorktree;
    seedSavedOrder([
      { kind: "terminal", id: "run-1" },
      { kind: "details" },
      { kind: "changes" },
      { kind: "doc", id: "design" },
      { kind: "doc", id: "notes" },
    ]);
    mountWorkspace();
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "Changes",
      "DESIGN",
      "NOTES",
    ]));
    await waitFor(() => expect(workspaceTab("Details"))
      .toHaveAttribute("draggable", "true"));

    const cancelled = beginDrag("NOTES", "codex terminal", "near");
    expect(screen.getByTestId("workspace-tab-drop-seam"))
      .toHaveAttribute("data-drop-intent", "near");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("workspace-tab-drop-seam")).toBeNull();
    void cancelled;

    const pending = deferred<WorkspaceTabIdentity[]>();
    saves.mockReturnValueOnce(pending.promise);
    const moved = beginDrag("NOTES", "codex terminal", "near");
    dropOn("codex terminal", moved);
    // The browser's trailing click at the end of the drag must not activate
    // the tab under the drop.
    fireEvent.click(workspaceTab("codex terminal"), { detail: 1 });

    await waitFor(() => expect(visibleTabNames()).toEqual([
      "NOTES",
      "codex terminal",
      "Details",
      "Changes",
      "DESIGN",
    ]));
    expect(within(screen.getByTestId("workspace-tabs")).getAllByRole("tab")
      .filter((tab) => tab.getAttribute("aria-label") !== "Changes")
      .every((tab) => tab.getAttribute("draggable") === "false")).toBe(true);
    expect(workspaceTab("Details")).toHaveAttribute("aria-selected", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    // A deliberate click right after the drop opens Changes at once — no
    // waiting out a suppression window.
    fireEvent.pointerDown(workspaceTab("Changes"));
    fireEvent.click(workspaceTab("Changes"), { detail: 1 });
    await waitFor(() => expect(workspaceTab("Changes"))
      .toHaveAttribute("aria-selected", "true"));
    fireEvent.pointerDown(workspaceTab("Details"));
    fireEvent.click(workspaceTab("Details"), { detail: 1 });
    await waitFor(() => expect(workspaceTab("Details"))
      .toHaveAttribute("aria-selected", "true"));

    const committed = [
      { kind: "doc" as const, id: "notes" },
      { kind: "terminal" as const, id: "run-1" },
      { kind: "details" as const },
      { kind: "changes" as const },
      { kind: "doc" as const, id: "design" },
    ];
    pending.resolve(committed);
    await waitFor(() => expect(workspaceTab("NOTES"))
      .toHaveAttribute("draggable", "true"));

    const rejected = deferred<WorkspaceTabIdentity[]>();
    saves.mockReturnValueOnce(rejected.promise);
    const failing = beginDrag("Details", "NOTES", "near");
    dropOn("NOTES", failing);
    // Keyboard activation carries no pointer detail, so pointer-drag
    // suppression must leave it alone even straight after a drop.
    fireEvent.click(workspaceTab("Changes"), { detail: 0 });
    await waitFor(() => expect(workspaceTab("Changes"))
      .toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(visibleTabNames()[0]).toBe("Details"));
    rejected.reject(new Error("save failed"));
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "NOTES",
      "codex terminal",
      "Details",
      "Changes",
      "DESIGN",
    ]));
    expect(useClientStore.getState().toasts.at(-1)?.message)
      .toContain("Workspace tabs could not be reordered");

    const transfer = beginDrag("DESIGN", "NOTES", "near");
    dispatchDrag(workspaceTab("NOTES"), "dragleave", transfer);
    transfer.dropEffect = "none";
    dispatchDrag(workspaceTab("DESIGN"), "dragend", transfer);

    await waitFor(() => expect(visibleTabNames()).toEqual([
      "DESIGN",
      "NOTES",
      "codex terminal",
      "Details",
      "Changes",
    ]));
    expect(saves).toHaveBeenCalledWith([
      { kind: "doc", id: "design" },
      { kind: "doc", id: "notes" },
      { kind: "terminal", id: "run-1" },
      { kind: "details" },
      { kind: "changes" },
    ]);

    // That drop finished without a trailing click. The suppression must expire
    // with the gesture, not linger and eat the next deliberate click.
    expect(workspaceTab("Changes")).toHaveAttribute("aria-selected", "true");
    fireEvent.pointerDown(workspaceTab("Details"));
    fireEvent.click(workspaceTab("Details"), { detail: 1 });
    await waitFor(() => expect(workspaceTab("Details"))
      .toHaveAttribute("aria-selected", "true"));
  });
});
