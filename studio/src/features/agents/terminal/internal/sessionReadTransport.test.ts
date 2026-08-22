import { describe, expect, it, vi } from "vitest";

import { initializeStudioRuntime, type StudioRuntime } from "../../../../runtime";
import {
  readScratchResumableTerminalSessions,
  readTaskResumableTerminalSessions,
} from "./sessionReadTransport";

function desktopRuntime(
  readWorkTracker: StudioRuntime["readWorkTracker"],
): StudioRuntime {
  return {
    platform: "desktop",
    capabilities: {
      statusFeed: true,
      websocketTerminal: false,
      nativeLifecycle: true,
      serviceSupervision: true,
      nativeTerminal: true,
      nativeFolderPicker: true,
    },
    readWorkTracker,
    writeWorkTracker: readWorkTracker,
    readSettings: readWorkTracker,
    writeSettings: readWorkTracker,
    statusStream: () => null,
    documentUrl: (id, path) => `ticketrydoc://localhost/${id}/${path}`,
    pickFolder: async () => null,
    retryServices: async () => {},
    startup: () => ({
      endpoints: {
        workTrackerApi: "/api/work-tracker",
        agentApi: "/api",
        statusApi: "/api",
        terminalWebSocket: "/ws/terminal",
      },
      values: { workTrackerApiKey: "" },
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    }),
    subscribeServiceHealth: () => () => {},
    subscribeUserNotices: () => () => {},
  };
}

describe("resumable terminal reads", () => {
  it("uses the caller-owned task and Scratch GraphQL operations on desktop", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const execute = vi.fn(async (
      document: { operationName: string },
      variables: unknown,
    ) => ({
      resumable_sessions: [{
        agent_run_id: document.operationName === "TaskResumableTerminalSessions"
          ? "task-run"
          : "scratch-run",
        agent: "codex",
        status: "completed",
        started_at: "2026-08-19T10:00:00Z",
        ended_at: "2026-08-19T11:00:00Z",
        launch_state: document.operationName === "TaskResumableTerminalSessions"
          ? "Implement"
          : null,
        launch_model: "gpt-5",
        provider_session_id: "provider-session",
        resumed_from: null,
        scope: document.operationName === "TaskResumableTerminalSessions"
          ? "task"
          : "plan",
      }],
      variables,
    }));
    initializeStudioRuntime(
      desktopRuntime((routes) => routes.graphQl(execute as never)),
    );

    const task = await readTaskResumableTerminalSessions("task-id");
    const scratch = await readScratchResumableTerminalSessions(
      "project-id",
      "module-id",
    );

    expect(execute.mock.calls.map(([document]) => document.operationName)).toEqual([
      "TaskResumableTerminalSessions",
      "ScratchResumableTerminalSessions",
    ]);
    expect(execute.mock.calls.map(([, variables]) => variables)).toEqual([
      { taskId: "task-id" },
      { projectId: "project-id", moduleId: "module-id" },
    ]);
    expect(task[0]).toMatchObject({
      agent_run_id: "task-run",
      launch_state: "Implement",
      launch_model: "gpt-5",
    });
    expect(scratch[0]).toMatchObject({ agent_run_id: "scratch-run", scope: "plan" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
