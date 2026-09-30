import { describe, expect, it } from "vitest";

import type { RunRecord } from "../status";
import { excludeResumableTerminalRuns } from "./runTabRestoration";

function run(agentRunId: string, providerSessionId: string): RunRecord {
  return {
    agent_run_id: agentRunId,
    project_id: "project-1",
    task_id: "story-1",
    module_id: "module-1",
    agent: "codex",
    provider_session_id: providerSessionId,
    scope: "task",
    state: "working",
    updated_at: "2026-09-02T12:00:00Z",
  };
}

describe("terminal tab restoration", () => {
  it("rejects resumable rows and stale predecessors of a live successor", () => {
    const runs = [
      run("stopped-a", "conversation-a"),
      run("stopped-b", "conversation-b"),
      run("stale-source", "conversation-live"),
      run("live-successor", "conversation-live"),
    ];
    const stopped = new Set(["stopped-a", "stopped-b"]);

    expect(excludeResumableTerminalRuns(runs, stopped)).toEqual([
      run("live-successor", "conversation-live"),
    ]);
  });
});
