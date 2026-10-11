import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useStudioStore } from "../features/projects/store";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalStore } from "../features/agents/terminal";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";

const documentRegistry = vi.hoisted(() => ({
  listTaskDocuments: vi.fn(),
  listScratchDocuments: vi.fn(),
}));

vi.mock("../features/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/documents")>()),
  ...documentRegistry,
}));

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
  "../features/task-workspace/terminals/SelectedTicketTerminal",
  () => ({
    SelectedTicketTerminal: ({ bucket }: { bucket: string }) =>
      <div data-testid="selected-ticket-terminal">{bucket}</div>,
  }),
);

/** A live plain login shell, as the run status reports a Work Item shell. */
function shellRun(agentRunId: string, taskId: string | null) {
  return {
    agent_run_id: agentRunId,
    project_id: "project-1",
    task_id: taskId,
    module_id: "module-1",
    agent: null,
    scope: "shell" as const,
    state: "working" as const,
    launch_state: null,
    launch_model: null,
    started_at: "2026-10-11T12:00:00Z",
    updated_at: "2026-10-11T12:00:00Z",
  };
}

describe("Work Item shell in its ticket workspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installDesktopGraphQlRuntime(terminalSessionReadExecutor(terminalReads));
    localStorage.clear();
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: "story-1",
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
    terminalReads.readTaskTerminalSessions.mockResolvedValue([]);
    terminalReads.readScratchTerminalSessions.mockResolvedValue([]);
    terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([]);
  });

  it("presents the Work Item's live shell as a closable tab and keeps module shells out", async () => {
    useAgentStatusStore.setState({
      runs: {
        "run-task-shell": shellRun("run-task-shell", "story-1"),
        "run-module-shell": shellRun("run-module-shell", null),
      },
    });

    render(
      <SelectedTicketContent
        bucket="story-1"
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<div>Issue details</div>}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "shell terminal" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Close shell terminal" })).toBeInTheDocument();
    const shellSessions = Object.values(useTerminalStore.getState().sessions)
      .filter((meta) => meta.agent === null);
    expect(shellSessions.map((meta) => [meta.agentRunId, meta.taskId])).toEqual([
      ["run-task-shell", "story-1"],
    ]);
  });
});
