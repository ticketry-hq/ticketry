import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "../app/stores/toastStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useWorkspaceTabsStore } from "../features/agents/terminal/internal/workspaceTabsStore";
import { closeTerminalTab } from "../app/shell/ticket-workspace/selected-ticket/internal/closeTerminalTab";
import { useTicketWorkspaceStore } from "../app/shell/ticket-workspace/selected-ticket/state/ticketWorkspaceStore";

const terminatePersisted = useTerminalStore.getState().terminatePersisted;

describe("closeTerminalTab", () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: {},
      sessionByRun: {},
      persistedSessions: {},
      resumableSessions: {},
      terminatePersisted,
    });
    useWorkspaceTabsStore.setState({
      byTaskId: {},
      activeByTask: {},
      chatByDoc: {},
      focusRequest: null,
    });
    useTicketWorkspaceStore.setState({ workspaces: {} });
    useTicketWorkspaceStore.getState().ensureWorkspace("task-1");
    useToastStore.setState({ toasts: [] });
  });

  it("keeps the tab open and records no history chip when termination fails", async () => {
    const sessionId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "project-1",
      moduleId: "module-1",
      agent: "codex",
      ticketSeq: 12,
      agentRunId: "run-1",
    });
    const failedTermination = vi
      .fn()
      .mockRejectedValue(new Error("backend refused termination"));
    useTerminalStore.setState({ terminatePersisted: failedTermination });

    await closeTerminalTab(sessionId, "task-1");

    expect(failedTermination).toHaveBeenCalledWith("run-1", "task-1");
    expect(useTerminalStore.getState().sessions[sessionId]).toBeDefined();
    expect(
      useTicketWorkspaceStore.getState().workspaces["task-1"].history,
    ).toEqual([]);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        kind: "error",
        message: expect.stringContaining("backend refused termination"),
      }),
    ]);
  });
});
