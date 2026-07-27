import { beforeEach, describe, expect, it } from "vitest";
import { launchAgent, useTerminalStore } from "../../features/agents/terminal";

describe("terminalSessionsStore split state", () => {
  beforeEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  });

  it("indexes a bound run and preserves it across acknowledgement", () => {
    const tempId = launchAgent({
      taskId: "task-1",
      projectId: "project-1",
      agent: "codex",
      ticketSeq: 981,
      agentRunId: "run-1",
    });
    expect(useTerminalStore.getState().sessionByRun["run-1"]).toBe(tempId);

    useTerminalStore.getState().setReady(tempId, "session-1");
    const state = useTerminalStore.getState();
    expect(state.sessionByRun["run-1"]).toBe("session-1");
    expect(state.sessions["session-1"]).toMatchObject({
      transport: "ready",
      backendSession: "alive",
      agentRunId: "run-1",
    });
  });

  it("removes only the matching run index when a session closes", () => {
    const id = launchAgent({
      taskId: "task-1",
      projectId: "project-1",
      agent: "codex",
      ticketSeq: 981,
      agentRunId: "run-1",
    });
    useTerminalStore.getState().closeTab(id);
    expect(useTerminalStore.getState().sessionByRun).toEqual({});
  });
});
