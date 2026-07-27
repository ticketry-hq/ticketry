import { describe, expect, it } from "vitest";
import {
  selectLiveTerminalStops,
  selectLiveTerminalStop,
  type LiveTerminalStop,
} from "../features/studio/lib/liveTerminalCycle";
import type { Row } from "../features/studio/pages/tasks/TasksPane";

function taskRow(taskId: string): Row {
  return { task: { id: taskId } } as Row;
}

describe("live-terminal cycle selector", () => {
  it("orders only local live task terminals by visible row and tab order", () => {
    const stops = selectLiveTerminalStops({
      moduleId: "module-1",
      taskRows: [
        taskRow("task-b"),
        { kind: Symbol("header"), key: "header", stateName: "Todo", count: 2 } as Row,
        taskRow("task-a"),
      ],
      agentStatus: {
        projectId: "project-1",
        runs: {
          "run-b-1": {
            runId: "run-b-1",
            taskId: "task-b",
            moduleId: "module-1",
            scope: "task",
            state: "quiet",
            updatedAt: "2026-07-17T12:00:00Z",
          },
          "run-b-2": {
            runId: "run-b-2",
            taskId: "task-b",
            moduleId: "module-1",
            scope: "task",
            state: "needs_input",
            updatedAt: "2026-07-17T12:00:00Z",
          },
          "run-b-exited": {
            runId: "run-b-exited",
            taskId: "task-b",
            moduleId: "module-1",
            scope: "task",
            state: "exited",
            updatedAt: "2026-07-17T12:00:00Z",
          },
          "run-a-live": {
            runId: "run-a-live",
            taskId: "task-a",
            moduleId: "module-1",
            scope: "task",
            state: "working",
            updatedAt: "2026-07-17T12:00:00Z",
          },
          "run-a-lost": {
            runId: "run-a-lost",
            taskId: "task-a",
            moduleId: "module-1",
            scope: "task",
            state: "lost",
            updatedAt: "2026-07-17T12:00:00Z",
          },
          "run-no-terminal": {
            runId: "run-no-terminal",
            taskId: "task-a",
            moduleId: "module-1",
            scope: "task",
            state: "working",
            updatedAt: "2026-07-17T12:00:00Z",
          },
          "run-scratch": {
            runId: "run-scratch",
            taskId: null,
            moduleId: "module-1",
            scope: "instant",
            state: "working",
            updatedAt: "2026-07-17T12:00:00Z",
          },
          "run-other-module": {
            runId: "run-other-module",
            taskId: "task-a",
            moduleId: "module-2",
            scope: "task",
            state: "working",
            updatedAt: "2026-07-17T12:00:00Z",
          },
        },
        byTask: {},
        automationAttempts: {},
        automationByTask: {},
      },
      sessions: {
        "session-b-1": {
          sessionId: "session-b-1",
          agentRunId: "run-b-1",
          taskId: "task-b",
          moduleId: "module-1",
          isDocChat: false,
        },
        "session-b-2": {
          sessionId: "session-b-2",
          agentRunId: "run-b-2",
          taskId: "task-b",
          moduleId: "module-1",
          isDocChat: false,
        },
        "session-b-exited": {
          sessionId: "session-b-exited",
          agentRunId: "run-b-exited",
          taskId: "task-b",
          moduleId: "module-1",
          isDocChat: false,
        },
        "session-a-live": {
          sessionId: "session-a-live",
          agentRunId: "run-a-live",
          taskId: "task-a",
          moduleId: "module-1",
          isDocChat: false,
        },
        "session-a-lost": {
          sessionId: "session-a-lost",
          agentRunId: "run-a-lost",
          taskId: "task-a",
          moduleId: "module-1",
          isDocChat: false,
        },
        "session-scratch": {
          sessionId: "session-scratch",
          agentRunId: "run-scratch",
          taskId: null,
          moduleId: "module-1",
          isDocChat: false,
        },
        "session-other-module": {
          sessionId: "session-other-module",
          agentRunId: "run-other-module",
          taskId: "task-a",
          moduleId: "module-2",
          isDocChat: false,
        },
      },
      tabsByTask: {
        "task-b": ["session-b-2", "session-b-exited", "session-b-1"],
        "task-a": ["session-a-lost", "session-other-module", "session-a-live"],
        "__scratch__:module-1": ["session-scratch"],
      },
    });

    expect(stops).toEqual([
      {
        taskId: "task-b",
        sessionId: "session-b-2",
        agentRunId: "run-b-2",
      },
      {
        taskId: "task-b",
        sessionId: "session-b-1",
        agentRunId: "run-b-1",
      },
      {
        taskId: "task-a",
        sessionId: "session-a-live",
        agentRunId: "run-a-live",
      },
    ]);
  });

  it("advances from terminal identity and restarts from the top after churn", () => {
    const stops: LiveTerminalStop[] = [
      { taskId: "task-a", sessionId: "session-a", agentRunId: "run-a" },
      { taskId: "task-b", sessionId: "session-b", agentRunId: "run-b" },
      { taskId: "task-c", sessionId: "session-c", agentRunId: "run-c" },
    ];

    expect([
      selectLiveTerminalStop(stops, "session-a", "forward"),
      selectLiveTerminalStop(stops, "session-c", "forward"),
      selectLiveTerminalStop(
        [
          {
            taskId: "task-new",
            sessionId: "session-new",
            agentRunId: "run-new",
          },
          ...stops,
        ],
        "session-b",
        "forward",
      ),
      selectLiveTerminalStop(stops, "vanished-session", "forward"),
      selectLiveTerminalStop([], "session-a", "forward"),
    ]).toEqual([stops[1], stops[0], stops[2], stops[0], null]);
  });
});
