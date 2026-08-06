import { describe, expect, it } from "vitest";
import { deriveTaskSessions } from "../features/agents/terminal/hooks";
import type { SessionMeta } from "../features/agents/terminal";
import type { AgentStatusRun } from "../features/agents/status";

function session(runId: string, taskId = "task-1"): SessionMeta {
  return {
    sessionId: runId,
    taskId,
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    ticketSeq: 1,
    status: "ready",
    transport: "ready",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId: runId,
    isDocChat: false,
    docRelPath: null,
    docId: null,
  };
}

function run(runId: string, startedAt: string, state: AgentStatusRun["state"]): AgentStatusRun {
  return {
    runId,
    projectId: "project-1",
    taskId: "task-1",
    moduleId: "module-1",
    agent: "codex",
    scope: "task",
    startedAt,
    state,
    updatedAt: startedAt,
  };
}

describe("run-derived task workspace", () => {
  it("orders terminal tabs by run start and subtracts closed run ids", () => {
    const sessions = { later: session("later"), earlier: session("earlier") };
    const runs = {
      later: run("later", "2026-08-06T11:00:00Z", "working"),
      earlier: run("earlier", "2026-08-06T10:00:00Z", "working"),
    };

    expect(deriveTaskSessions("task-1", sessions, runs, new Set()).map((tab) => tab.id))
      .toEqual(["earlier", "later"]);
    expect(deriveTaskSessions("task-1", sessions, runs, new Set(["earlier"]))
      .map((tab) => tab.id)).toEqual(["later"]);
  });

  it("keeps a dead run's tab and projects dead liveness immediately", () => {
    const tabs = deriveTaskSessions(
      "task-1",
      { dead: session("dead") },
      { dead: run("dead", "2026-08-06T10:00:00Z", "lost") },
      new Set(),
    );

    expect(tabs).toHaveLength(1);
    expect(tabs[0].lifecycle).toBe("lost");
  });
});
