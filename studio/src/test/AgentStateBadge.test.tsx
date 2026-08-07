import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentStateBadge } from "../features/agents/lifecycle";
import { useAgentStatusStore, type RunRecord } from "../features/agents/status";

function run(
  runId: string,
  taskId: string,
  state: RunRecord["state"],
): RunRecord {
  return {
    agent_run_id: runId,
    task_id: taskId,
    module_id: "module-1",
    scope: "task",
    state,
    updated_at: "2026-07-15T10:00:00Z",
  };
}

describe("AgentStateBadge direct-task status", () => {
  beforeEach(() => {
    useAgentStatusStore.setState({ projectId: null, runs: {} });
  });

  it("shows compact count chicklets for each live state on the task", () => {
    const status = useAgentStatusStore.getState();
    status.upsertRun(run("working-run", "task-1", "working"));
    status.upsertRun(run("attention-run", "task-1", "needs_input"));
    status.upsertRun(run("second-attention-run", "task-1", "needs_input"));
    status.upsertRun(run("child-run", "child-1", "working"));

    render(<AgentStateBadge issueId="task-1" />);

    const badge = within(screen.getByTestId("agent-state-badge"));
    expect(badge.getByLabelText("Agent is waiting for your input")).toHaveTextContent(
      "?2",
    );
    expect(badge.getByLabelText("Agent is actively working")).toHaveTextContent(
      "▶1",
    );
    expect(badge.getAllByLabelText(/Agent/)).toHaveLength(2);
  });
});
