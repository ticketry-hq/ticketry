import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useStudioStore } from "../features/projects/store";
import { useAgentStatusStore } from "../features/agents/status";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

const terminalApi = vi.hoisted(() => ({
  getTerminals: vi.fn(),
  listResumableTerminals: vi.fn(),
  resumeTerminal: vi.fn(),
}));

const documentRegistry = vi.hoisted(() => ({
  listTaskDocuments: vi.fn(),
  listScratchDocuments: vi.fn(),
}));

function statusTransport() {
  let deliver: ((encoded: string) => void) | null = null;
  const proxy = {
    graphql_execute: vi.fn(async () => "{}"),
    graphql_subscribe: vi.fn(async (
      _id: string,
      _request: string,
      onEvent: (value: string) => void,
    ) => {
      deliver = onEvent;
      return '{"type":"accepted"}';
    }),
    graphql_unsubscribe: vi.fn(async () => true),
  };
  return {
    createProxy: () => proxy as never,
    send(frame: unknown) {
      deliver?.(JSON.stringify({
        type: "next",
        payload: { data: { run_status_stream: frame } },
      }));
    },
  };
}

vi.mock("../features/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/documents")>()),
  ...documentRegistry,
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({
    SelectedTicketTerminal: ({ bucket, active }: { bucket: string; active: boolean }) => (
      <div data-testid="selected-ticket-terminal" data-active={String(active)}>{bucket}</div>
    ),
  }),
);

function session(
  sessionId: string,
  taskId: string,
  agentRunId: string,
  status: SessionMeta["status"] = "ready",
): SessionMeta {
  return {
    sessionId,
    taskId,
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    status,
    transport: status === "ready" ? "ready" : "closed",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId,
  };
}

function run(
  agentRunId: string,
  taskId: string,
  state: "working" | "exited" | "lost" = "working",
) {
  return {
    agent_run_id: agentRunId,
    task_id: taskId,
    module_id: "module-1",
    scope: "task" as const,
    state,
    started_at: "2026-08-07T12:00:00Z",
    updated_at: "2026-08-07T12:00:00Z",
  };
}

describe("overhaul acceptance — terminals", () => {
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
      sidebarVisible: true,
      storySearchQuery: "",
      collapsedStateIds: new Set(["todo"]),
      expandedIdsByModule: {},
      workspaces: {},
      activeByTask: {},
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });
    documentRegistry.listTaskDocuments.mockResolvedValue([]);
    documentRegistry.listScratchDocuments.mockResolvedValue([]);
    terminalApi.getTerminals.mockResolvedValue([]);
    terminalApi.listResumableTerminals.mockResolvedValue([]);
    statusStreamFeed.resetCursors("project-1");
  });

  afterEach(() => {
    statusStreamFeed.stop();
    vi.unstubAllGlobals();
  });

  it("[overhaul-135] opens a document tab discovered by the backend watcher", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(documentRegistry.listTaskDocuments).toHaveBeenCalled());

    documentRegistry.listTaskDocuments.mockResolvedValue([
      { id: "spec", rel_path: "SPEC.html", label: "Spec" },
    ]);
    const feed = statusTransport();
    statusStreamFeed.start("project-1", { createProxy: feed.createProxy });
    await Promise.resolve();
    act(() => feed.send({
      __typename: "RunStatusEvent",
      cursor: 1,
      event_id: "document-created-1",
      project_id: "project-1",
      event_kind: "document.changed",
      payload_version: 1,
      subject_kind: "design_document",
      subject_id: "spec",
      agent_run_id: null,
      automation_attempt_id: null,
      work_item_id: "story-1",
      payload: {
        documentId: "spec",
        scope: "task",
        ownerId: "story-1",
        moduleId: "module-1",
        relPath: "SPEC.html",
        changeKind: "created",
      },
      committed_at: "2026-08-14T12:00:00Z",
    }));

    expect(await screen.findByRole("tab", { name: "Spec" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("[overhaul-50] keeps the same opened terminal mounted across Details and documents", async () => {
    documentRegistry.listTaskDocuments.mockResolvedValue([
      { id: "design", rel_path: "DESIGN.md", label: "Design" },
    ]);
    useTerminalStore.setState({
      sessions: { "session-1": session("session-1", "story-1", "run-1") },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({ runs: { "run-1": run("run-1", "story-1") } });
    useClientStore.setState({ activeByTask: { "story-1": "session-1" } });

    render(
      <QueryClientProvider client={queryClient}>
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      </QueryClientProvider>,
    );

    const terminal = await screen.findByTestId("selected-ticket-terminal");
    expect(terminal).toHaveAttribute("data-active", "false");

    fireEvent.click(screen.getByRole("tab", { name: "codex terminal" }));
    expect(terminal).toHaveAttribute("data-active", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(terminal).toHaveAttribute("data-active", "false");

    fireEvent.click(await screen.findByRole("tab", { name: "Design" }));
    expect(screen.getByTestId("selected-ticket-terminal")).toBe(terminal);
    expect(terminal).toHaveAttribute("data-active", "false");

    fireEvent.click(screen.getByRole("tab", { name: "codex terminal" }));
    expect(screen.getByTestId("selected-ticket-terminal")).toBe(terminal);
    expect(terminal).toHaveAttribute("data-active", "true");
  });

  it("[overhaul-70] keeps retained viewers mounted through a Work item with no terminals", async () => {
    useTerminalStore.setState({
      sessions: { "session-1": session("session-1", "story-1", "run-1") },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({ runs: { "run-1": run("run-1", "story-1") } });
    useClientStore.setState({ activeByTask: { "story-1": "session-1" } });

    const workspace = (bucket: string) => (
      <QueryClientProvider client={queryClient}>
        <SelectedTicketContent
          bucket={bucket}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      </QueryClientProvider>
    );
    const view = render(workspace("story-1"));

    const retainedHost = await screen.findByTestId("selected-ticket-terminal");
    expect(retainedHost).toHaveTextContent("story-1");

    view.rerender(workspace("story-empty"));
    expect(screen.getByTestId("selected-ticket-terminal")).toBe(retainedHost);
    expect(retainedHost).toHaveTextContent("story-empty");
    expect(retainedHost).toHaveAttribute("data-active", "false");

    view.rerender(workspace("story-1"));
    expect(screen.getByTestId("selected-ticket-terminal")).toBe(retainedHost);
    expect(retainedHost).toHaveTextContent("story-1");
  });

  it("does not create a tab for a run omitted by terminal discovery", async () => {
    useAgentStatusStore.setState({
      runs: { "run-foreign": run("run-foreign", "story-1") },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(terminalApi.getTerminals).toHaveBeenCalled());
    expect(screen.queryByRole("tab", { name: "codex terminal" }))
      .not.toBeInTheDocument();
    expect(useTerminalStore.getState().sessions).toEqual({});
  });
});
