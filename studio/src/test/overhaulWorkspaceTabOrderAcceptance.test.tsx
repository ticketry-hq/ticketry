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
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";
import { seedModuleOpenFixture } from "./projectOpenFixture";
import { workItem } from "./seam";
import type { WorkspaceTabIdentity } from "../features/workspace-tabs/types";

const WORK_ITEM_ID = "story-917";

const documentRegistry = vi.hoisted(() => ({
  listTaskDocuments: vi.fn(),
  listScratchDocuments: vi.fn(),
}));
const saves = vi.hoisted(() => vi.fn());

vi.mock("../features/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/documents")>()),
  ...documentRegistry,
}));

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
    from: { __typename: "WorktrackerIssue", id: WORK_ITEM_ID },
    optimistic: false,
  });
  if (!row) throw new Error("Workspace fixture row is missing.");
  return { ...row, workspace_tab_order: order };
}

function installRuntime(): void {
  const terminalExecutor = terminalSessionReadExecutor(terminalReads);
  installDesktopGraphQlRuntime(async (document, variables) => {
    if (documentOperationName(document) === "UpdateWorkTrackerWorkspaceTabOrder") {
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
      id: WORK_ITEM_ID,
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

    act(() => useTerminalStore.setState({ sessions: {}, sessionByRun: {} }));
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "Details",
      "DESIGN",
      "NOTES",
    ]));
    act(() => useTerminalStore.setState({
      sessions: { "viewer-1": terminal },
      sessionByRun: { "run-1": "viewer-1" },
    }));
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
    seedSavedOrder([
      { kind: "terminal", id: "run-1" },
      { kind: "details" },
      { kind: "doc", id: "design" },
      { kind: "doc", id: "notes" },
    ]);
    mountWorkspace();
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
    fireEvent.click(workspaceTab("codex terminal"));

    await waitFor(() => expect(visibleTabNames()).toEqual([
      "NOTES",
      "codex terminal",
      "Details",
      "DESIGN",
    ]));
    expect(within(screen.getByTestId("workspace-tabs")).getAllByRole("tab")
      .every((tab) => tab.getAttribute("draggable") === "false")).toBe(true);
    expect(workspaceTab("Details")).toHaveAttribute("aria-selected", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    const committed = [
      { kind: "doc" as const, id: "notes" },
      { kind: "terminal" as const, id: "run-1" },
      { kind: "details" as const },
      { kind: "doc" as const, id: "design" },
    ];
    pending.resolve(committed);
    await waitFor(() => expect(workspaceTab("NOTES"))
      .toHaveAttribute("draggable", "true"));

    const rejected = deferred<WorkspaceTabIdentity[]>();
    saves.mockReturnValueOnce(rejected.promise);
    const failing = beginDrag("Details", "NOTES", "near");
    dropOn("NOTES", failing);
    await waitFor(() => expect(visibleTabNames()[0]).toBe("Details"));
    rejected.reject(new Error("save failed"));
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "NOTES",
      "codex terminal",
      "Details",
      "DESIGN",
    ]));
    expect(useClientStore.getState().toasts.at(-1)?.message)
      .toContain("Workspace tabs could not be reordered");
  });
});
