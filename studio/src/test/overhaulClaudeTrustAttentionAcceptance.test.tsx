import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentStateBadge, ScratchStateBadge } from "../features/agents/lifecycle";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { applyRunStatusFrame } from "../features/agents/status/stream/runStatusHolding";
import { applySnapshotFrame } from "../features/agents/status/stream/statusSnapshot";
import {
  lifecycleStatusFrame,
  statusRunHolding,
} from "../features/agents/status/testing/durableStatusFrames";
import { useTerminalStore } from "../features/agents/terminal/appNavigation";
import { registerTerminalFocus } from "../features/agents/terminal/internal/terminalRegistry";
import { useStudioStore } from "../features/projects";
import { useClientStore } from "../state/clientStore";
import { InstantRunPlanningRow } from "../app/shell/ticket-workspace/tasks/components/ConversationRows";

const TRUST_REASON =
  "Claude is waiting for folder trust. Open its terminal to approve or decline.";
const STARTUP_REASON =
  "Claude startup needs attention. Open its terminal to continue.";

describe("overhaul acceptance — Claude launch attention", () => {
  beforeEach(() => {
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: "other-story",
      focusedPane: "tasks",
      sidebarVisible: true,
      workspaces: {},
      activeByTask: {},
    });
    useTerminalStore.setState({
      sessions: {
        "session-1": {
          sessionId: "session-1",
          taskId: "story-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "claude",
          status: "ready",
          transport: "ready",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-1",
        },
      },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {
        "run-1": {
          agent_run_id: "run-1",
          project_id: "project-1",
          task_id: "story-1",
          module_id: "module-1",
          agent: "claude",
          scope: "task",
          state: "needs_input",
          attention_reason: TRUST_REASON,
          started_at: "2026-09-25T09:59:00Z",
          updated_at: "2026-09-25T10:00:00Z",
        },
      },
      automationAttempts: {},
      automationByTask: {},
    });
  });

  it("[overhaul-392] keeps background automation trust attention passive and opens the original run terminal", async () => {
    const starting = useAgentStatusStore.getState().runs["run-1"];
    useAgentStatusStore.setState({
      runs: {
        "run-1": { ...starting, state: "starting", attention_reason: null },
      },
      automationAttempts: {
        "attempt-1": {
          attempt_id: "attempt-1",
          root_attempt_id: "attempt-1",
          retry_of_attempt_id: null,
          work_item_id: "story-1",
          status: "pending",
          error: null,
          failure: null,
          retryable: false,
          delivery_mode: "started_fresh",
          agent_run_id: "run-1",
          updated_at: "2026-09-25T10:00:00Z",
        },
      },
      automationByTask: { "story-1": ["attempt-1"] },
    });
    const focused = document.createElement("button");
    focused.textContent = "Current work";
    document.body.appendChild(focused);
    focused.focus();
    const terminal = document.createElement("button");
    document.body.appendChild(terminal);
    const unregister = registerTerminalFocus("session-1", () => terminal.focus());
    try {
      render(<AgentStateBadge issueId="story-1" />);
      act(() => applyRunStatusFrame(lifecycleStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        state: "needs_input",
        attentionReason: TRUST_REASON,
        at: "2026-09-25T10:00:01Z",
      })));
      expect(screen.getByTestId("agent-state-badge")).toHaveAttribute("data-state", "attention");
      const open = screen.getByRole("button", { name: TRUST_REASON });
      expect(document.activeElement).toBe(focused);
      expect(useClientStore.getState().selectedTaskId).toBe("other-story");

      fireEvent.click(open);
      await waitFor(() => expect(document.activeElement).toBe(terminal));
      expect(useClientStore.getState().selectedTaskId).toBe("story-1");
      expect(useClientStore.getState().workspaces["story-1"]?.active).toBe("terminal");
      expect(useTerminalStore.getState().sessionByRun["run-1"]).toBe("session-1");
      expect(Object.keys(useAgentStatusStore.getState().runs)).toEqual(["run-1"]);
      expect(useAgentStatusStore.getState().automationAttempts["attempt-1"])
        .toMatchObject({ status: "pending", agent_run_id: "run-1" });

      act(() => applyRunStatusFrame(lifecycleStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        state: "working",
        at: "2026-09-25T10:01:00Z",
      })));
      await waitFor(() => expect(screen.queryByRole("button", { name: TRUST_REASON })).toBeNull());
    } finally {
      unregister();
      focused.remove();
      terminal.remove();
    }
  });

  it("[overhaul-393] restores generic startup attention without calling it a trust failure", () => {
    const run = useAgentStatusStore.getState().runs["run-1"];
    const first = render(<AgentStateBadge issueId="story-1" />);
    expect(screen.getByRole("button", { name: TRUST_REASON })).toBeInTheDocument();
    first.unmount();

    // The next window receives the persisted holding with the safe generic
    // deadline reason. The action still addresses the original Agent Run.
    act(() => applySnapshotFrame({
      __typename: "RunStatusSnapshot",
      project_id: "project-1",
      cursor: 2,
      at: "2026-09-25T10:02:00Z",
      runs: [statusRunHolding({ ...run, attention_reason: STARTUP_REASON })],
      automation_attempts: [],
    }));
    render(<AgentStateBadge issueId="story-1" />);
    expect(screen.getByRole("button", { name: STARTUP_REASON })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TRUST_REASON })).toBeNull();
    expect(useTerminalStore.getState().sessionByRun["run-1"]).toBe("session-1");
  });

  it("[overhaul-394] opens the existing Plan terminal from passive scratch attention", async () => {
    const run = useAgentStatusStore.getState().runs["run-1"];
    useAgentStatusStore.setState({
      runs: { "run-1": { ...run, task_id: null, scope: "plan" } },
    });
    const focused = document.createElement("button");
    document.body.appendChild(focused);
    focused.focus();
    const terminal = document.createElement("button");
    document.body.appendChild(terminal);
    const unregister = registerTerminalFocus("session-1", () => terminal.focus());
    try {
      render(<ScratchStateBadge projectId="project-1" moduleId="module-1" />);
      const open = screen.getByRole("button", { name: TRUST_REASON });
      expect(document.activeElement).toBe(focused);
      fireEvent.click(open);
      await waitFor(() => expect(document.activeElement).toBe(terminal));
      expect(useTerminalStore.getState().sessionByRun["run-1"]).toBe("session-1");
      expect(Object.keys(useAgentStatusStore.getState().runs)).toEqual(["run-1"]);
    } finally {
      unregister();
      focused.remove();
      terminal.remove();
    }
  });

  it("[overhaul-395] reattaches the persisted Instant run after a fresh terminal store", async () => {
    const run = useAgentStatusStore.getState().runs["run-1"];
    useAgentStatusStore.setState({
      runs: { "run-1": { ...run, task_id: null, scope: "instant" } },
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    render(
      <InstantRunPlanningRow
        row={{ kind: "instant-run", runId: "run-1", moduleId: "module-1", name: "Launch chat", startedAt: run.started_at! }}
        isSelected={false}
        onClick={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: TRUST_REASON }));
    await waitFor(() => expect(useTerminalStore.getState().sessionByRun["run-1"]).toBeTruthy());
    const sessionId = useTerminalStore.getState().sessionByRun["run-1"];
    expect(useTerminalStore.getState().sessions[sessionId]).toMatchObject({
      agentRunId: "run-1",
      taskId: null,
      isInstant: true,
    });
    expect(Object.keys(useAgentStatusStore.getState().runs)).toEqual(["run-1"]);
  });
});
