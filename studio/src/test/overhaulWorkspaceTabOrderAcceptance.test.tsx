import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useAgentStatusStore } from "../features/agents/status";
import { useTerminalStore, type SessionMeta } from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";
import { selectLiveTerminalStops } from "../features/studio/lib/liveTerminalCycle";
import { dataTransfer, dragEvent } from "./moduleDragGestures";

const api = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  getTerminals: vi.fn(),
  listResumableTerminals: vi.fn(),
  resumeTerminal: vi.fn(),
  getWorkspaceTabOrder: vi.fn(),
  updateWorkspaceTabOrder: vi.fn(),
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  getDocuments: api.getDocuments,
  getTerminals: api.getTerminals,
  listResumableTerminals: api.listResumableTerminals,
  resumeTerminal: api.resumeTerminal,
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  getWorkspaceTabOrder: api.getWorkspaceTabOrder,
  updateWorkspaceTabOrder: api.updateWorkspaceTabOrder,
}));

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({ SelectedTicketTerminal: () => <div /> }),
);

const terminal: SessionMeta = {
  sessionId: "viewer-1",
  taskId: "story-917",
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

function mountWorkspace() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SelectedTicketContent
        bucket="story-917"
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<div>Issue details</div>}
      />
    </QueryClientProvider>,
  );
}

function visibleTabNames(): string[] {
  return within(screen.getByTestId("workspace-tabs"))
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("aria-label") ?? tab.textContent ?? "");
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

function workspaceTab(name: string): HTMLElement {
  return screen.getByRole("tab", { name });
}

function dragWorkspaceTab(
  sourceName: string,
  targetName: string,
  intent: "near" | "far",
  drop = true,
): void {
  const stripTabs = within(screen.getByTestId("workspace-tabs")).getAllByRole("tab");
  stripTabs.forEach((element, index) => {
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
  dragEvent(source, "dragstart", transfer);
  dragEvent(target, "dragover", transfer, { clientX });
  if (drop) dragEvent(target, "drop", transfer, { clientX });
}

describe("overhaul acceptance — server-owned workspace tab order", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    queryClient.clear();
    localStorage.clear();
    seedConfig({ features: { sidebar: true, projects: true } });
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
      runs: {
        "run-1": {
          agent_run_id: "run-1",
          task_id: "story-917",
          module_id: "module-1",
          scope: "task",
          state: "working",
          started_at: "2026-08-20T12:00:00Z",
          updated_at: "2026-08-20T12:00:00Z",
        },
      },
      automationAttempts: {},
      automationByTask: {},
    });
    api.getDocuments.mockResolvedValue({
      documents: [
        { id: "design", rel_path: "DESIGN.md", label: "Design" },
        { id: "notes", rel_path: "NOTES.md", label: "Notes" },
      ],
    });
    api.getTerminals.mockResolvedValue([]);
    api.listResumableTerminals.mockResolvedValue([]);
    api.resumeTerminal.mockResolvedValue({ agent_run_id: "run-1" });
    api.updateWorkspaceTabOrder.mockImplementation(
      async (_workItemId, value) => value,
    );
    api.getWorkspaceTabOrder.mockResolvedValue({
      order: [
        { kind: "terminal", id: "run-1" },
        { kind: "details" },
        { kind: "doc", id: "design" },
        { kind: "doc", id: "deleted-document" },
      ],
    });
  });

  it("[overhaul-149] restores the shared order after a workspace reload", async () => {
    const first = mountWorkspace();
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "Design",
      "Notes",
    ]));

    first.unmount();
    queryClient.clear();
    mountWorkspace();

    await waitFor(() => expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "Design",
      "Notes",
    ]));
    expect(api.getWorkspaceTabOrder).toHaveBeenCalledTimes(2);
  });

  it("[overhaul-153] restores a closed document at its remembered position", async () => {
    mountWorkspace();
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "Design",
      "Notes",
    ]));

    fireEvent.click(screen.getByRole("button", { name: "Close Design" }));
    expect(visibleTabNames()).toEqual(["codex terminal", "Details", "Notes"]);

    fireEvent.click(screen.getByRole("button", { name: "Reopen Design" }));
    expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "Design",
      "Notes",
    ]);
  });

  it("restores a dormant terminal at its remembered position", async () => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    api.getWorkspaceTabOrder.mockResolvedValue({
      order: [
        { kind: "doc", id: "design" },
        { kind: "terminal", id: "run-1" },
        { kind: "details" },
      ],
    });
    api.listResumableTerminals.mockResolvedValue([
      {
        agent_run_id: "run-1",
        agent: "codex",
        status: "exited",
        started_at: "2026-08-20T12:00:00Z",
        provider_session_id: "provider-1",
        resumed_from: null,
        scope: "task",
      },
    ]);
    mountWorkspace();

    const resume = await screen.findByRole("button", {
      name: /Resume codex terminal/i,
    });
    expect(visibleTabNames()).toEqual(["Design", "Details", "Notes"]);
    fireEvent.click(resume);

    await waitFor(() => expect(visibleTabNames()).toEqual([
      "Design",
      "codex terminal",
      "Details",
      "Notes",
    ]));
  });

  it("appends new documents and terminals after the remembered order", async () => {
    mountWorkspace();
    await waitFor(() => expect(api.updateWorkspaceTabOrder).toHaveBeenCalledWith(
      "story-917",
      {
        order: [
          { kind: "terminal", id: "run-1" },
          { kind: "details" },
          { kind: "doc", id: "design" },
          { kind: "doc", id: "deleted-document" },
          { kind: "doc", id: "notes" },
        ],
      },
    ));

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
      useAgentStatusStore.setState((state) => ({
        runs: {
          ...state.runs,
          "run-2": {
            ...state.runs["run-1"],
            agent_run_id: "run-2",
            agent: "claude",
            started_at: "2026-08-20T12:01:00Z",
          },
        },
      }));
    });

    await waitFor(() => expect(visibleTabNames().at(-1)).toBe("claude terminal"));
    await waitFor(() => expect(api.updateWorkspaceTabOrder).toHaveBeenLastCalledWith(
      "story-917",
      expect.objectContaining({
        order: expect.arrayContaining([
          { kind: "doc", id: "notes" },
          { kind: "terminal", id: "run-2" },
        ]),
      }),
    ));
    const lastOrder = api.updateWorkspaceTabOrder.mock.calls.at(-1)?.[1].order;
    expect(lastOrder.slice(-2)).toEqual([
      { kind: "doc", id: "notes" },
      { kind: "terminal", id: "run-2" },
    ]);
  });

  it("cycles live terminals in their mixed workspace order", () => {
    const sessions = {
      "viewer-1": terminal,
      "viewer-2": {
        ...terminal,
        sessionId: "viewer-2",
        agentRunId: "run-2",
      },
    };
    useAgentStatusStore.setState((state) => ({
      runs: {
        ...state.runs,
        "run-2": {
          ...state.runs["run-1"],
          agent_run_id: "run-2",
          started_at: "2026-08-20T12:01:00Z",
        },
      },
    }));

    const stops = selectLiveTerminalStops({
      moduleId: "module-1",
      taskRows: [],
      taskOrder: ["story-917"],
      agentStatus: useAgentStatusStore.getState(),
      sessions,
      terminalOrderByTask: { "story-917": ["run-2", "run-1"] },
    });

    expect(stops.map((stop) => stop.agentRunId)).toEqual(["run-2", "run-1"]);
  });

  it("[overhaul-154] drags workspace tabs with optimistic save and rollback", async () => {
    const scrolledInto: Element[] = [];
    const initialOrder = deferred<{
      order: Array<{
        kind: "details" | "doc" | "terminal";
        id?: string;
      }>;
    }>();
    api.getWorkspaceTabOrder.mockReturnValueOnce(initialOrder.promise);
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolledInto.push(this);
    });
    mountWorkspace();

    await waitFor(() => expect(visibleTabNames()).toEqual([
      "Details",
      "Design",
      "Notes",
      "codex terminal",
    ]));
    expect(
      within(screen.getByTestId("workspace-tabs"))
        .getAllByRole("tab")
        .every((element) => element.getAttribute("draggable") === "false"),
    ).toBe(true);
    dragWorkspaceTab("Details", "Design", "far");
    expect(api.updateWorkspaceTabOrder).not.toHaveBeenCalled();

    initialOrder.resolve({
      order: [
        { kind: "terminal", id: "run-1" },
        { kind: "details" },
        { kind: "doc", id: "design" },
        { kind: "doc", id: "deleted-document" },
      ],
    });
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "Design",
      "Notes",
    ]));
    await waitFor(() => expect(api.updateWorkspaceTabOrder).toHaveBeenCalled());
    api.updateWorkspaceTabOrder.mockClear();

    dragWorkspaceTab("codex terminal", "codex terminal", "near");
    fireEvent.click(workspaceTab("codex terminal"));
    expect(workspaceTab("Details")).toHaveAttribute("aria-selected", "true");
    expect(api.updateWorkspaceTabOrder).not.toHaveBeenCalled();

    dragWorkspaceTab("Notes", "codex terminal", "far", false);
    expect(screen.getByTestId("workspace-tab-drop-seam")).toHaveAttribute(
      "data-drop-intent",
      "far",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("workspace-tab-drop-seam")).toBeNull();
    expect(visibleTabNames()).toEqual([
      "codex terminal",
      "Details",
      "Design",
      "Notes",
    ]);
    expect(api.updateWorkspaceTabOrder).not.toHaveBeenCalled();

    const firstSave = deferred<{
      order: Array<{
        kind: "details" | "doc" | "terminal";
        id?: string;
      }>;
    }>();
    api.updateWorkspaceTabOrder.mockReturnValueOnce(firstSave.promise);
    scrolledInto.length = 0;
    dragWorkspaceTab("Notes", "codex terminal", "near");

    await waitFor(() => expect(api.updateWorkspaceTabOrder).toHaveBeenCalledWith(
      "story-917",
      {
        order: [
          { kind: "doc", id: "notes" },
          { kind: "terminal", id: "run-1" },
          { kind: "details" },
          { kind: "doc", id: "design" },
        ],
      },
    ));
    expect(visibleTabNames()).toEqual([
      "Notes",
      "codex terminal",
      "Details",
      "Design",
    ]);
    expect(
      within(screen.getByTestId("workspace-tabs"))
        .getAllByRole("tab")
        .every((element) => element.getAttribute("draggable") === "false"),
    ).toBe(true);
    expect(workspaceTab("Details")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(workspaceTab("codex terminal"));
    expect(workspaceTab("Details")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(scrolledInto).toContain(workspaceTab("Details")));

    firstSave.resolve({
      order: [
        { kind: "doc", id: "notes" },
        { kind: "terminal", id: "run-1" },
        { kind: "details" },
        { kind: "doc", id: "design" },
      ],
    });
    await waitFor(() =>
      expect(workspaceTab("Notes")).toHaveAttribute("draggable", "true"),
    );

    api.updateWorkspaceTabOrder.mockRejectedValueOnce(new Error("save failed"));
    dragWorkspaceTab("Details", "Notes", "near");
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "Details",
      "Notes",
      "codex terminal",
      "Design",
    ]));
    await waitFor(() => expect(visibleTabNames()).toEqual([
      "Notes",
      "codex terminal",
      "Details",
      "Design",
    ]));
    expect(useClientStore.getState().toasts.at(-1)?.message).toContain(
      "Workspace tabs could not be reordered",
    );
  });
});
