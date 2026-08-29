import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { useStudioStore } from "../features/projects/store";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";

const terminalApi = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  resumeTerminal: vi.fn(),
  terminateTerminal: vi.fn(),
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

// Terminal session reads moved to the Rust Terminal Session graph, so the seam
// a test controls is the read transport, not a host API module.
const terminalReads = vi.hoisted(() => {
  const resumable = vi.fn();
  return {
    readTaskTerminalSessions: vi.fn(),
    readScratchTerminalSessions: vi.fn(),
    readTaskResumableTerminalSessions: resumable,
    readScratchResumableTerminalSessions: resumable,
  };
});

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({
    SelectedTicketTerminal: ({ bucket }: { bucket: string }) => (
      <div data-testid="selected-ticket-terminal">{bucket}</div>
    ),
  }),
);

function KeymapHarness() {
  useGlobalKeymap();
  return null;
}

function liveSession(): SessionMeta {
  return {
    sessionId: "session-old",
    taskId: "story-1",
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    status: "ready",
    transport: "ready",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId: "run-old",
  };
}

function mountLiveTerminal({ keyboard = false }: { keyboard?: boolean } = {}) {
  useTerminalStore.setState({
    sessions: { "session-old": liveSession() },
    sessionByRun: { "run-old": "session-old" },
  });
  useClientStore.setState({
    workspaces: {
      "story-1": {
        active: "terminal",
        activeDocId: null,
        closedDocIds: [],
      },
    },
    activeByTask: { "story-1": "session-old" },
  });
  useAgentStatusStore.setState({
    runs: {
      "run-old": {
        agent_run_id: "run-old",
        task_id: "story-1",
        module_id: "module-1",
        scope: "task",
        state: "working",
        started_at: "2026-08-07T12:00:00Z",
        updated_at: "2026-08-07T12:00:00Z",
      },
    },
  });

  render(
    <>
      {keyboard && <KeymapHarness />}
      <SelectedTicketContent
        bucket="story-1"
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<div>Issue details</div>}
      />
    </>,
  );
}

describe("overhaul acceptance — terminal close synchronization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installDesktopGraphQlRuntime(terminalSessionReadExecutor(terminalReads));
    localStorage.clear();
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: "story-1",
      focusedPane: "tasks",
      sidebarVisible: true,
      workspaces: {},
      activeByTask: {},
      toasts: [],
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });
    terminalApi.getDocuments.mockResolvedValue({ documents: [] });
    terminalReads.readTaskTerminalSessions.mockResolvedValue([]);
    terminalReads.readScratchTerminalSessions.mockResolvedValue([]);
    terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([]);
  });

  it("refreshes resumable sessions through the shared keyboard close path", async () => {
    terminalReads.readTaskResumableTerminalSessions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        agent_run_id: "run-old",
        agent: "codex",
        status: "exited",
        started_at: "2026-08-07T12:00:00Z",
        ended_at: "2026-08-07T12:30:00Z",
        provider_session_id: "provider-session",
        resumed_from: null,
        scope: "task",
      }]);
    terminalApi.terminateTerminal.mockResolvedValue({
      agent_run_id: "run-old",
      terminated: true,
    });
    mountLiveTerminal({ keyboard: true });
    await waitFor(() => {
      expect(terminalReads.readTaskResumableTerminalSessions).toHaveBeenCalledTimes(1);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "q",
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(await screen.findByRole("button", {
      name: "Resume codex terminal",
    })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "codex terminal" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("Issue details")).toBeInTheDocument();
  });

  it("keeps the terminal and stale resumable result when close is rejected", async () => {
    terminalApi.terminateTerminal.mockRejectedValue(new Error("refused"));
    mountLiveTerminal();
    await waitFor(() => {
      expect(terminalReads.readTaskResumableTerminalSessions).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", {
      name: "Close codex terminal",
    }));

    await waitFor(() => {
      expect(useClientStore.getState().toasts).toContainEqual(
        expect.objectContaining({
          kind: "error",
          message: "Terminal could not be closed: refused",
        }),
      );
    });
    expect(screen.getByRole("tab", { name: "codex terminal" }))
      .toBeInTheDocument();
    expect(terminalReads.readTaskResumableTerminalSessions).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Resume codex terminal" }))
      .not.toBeInTheDocument();
  });
});
