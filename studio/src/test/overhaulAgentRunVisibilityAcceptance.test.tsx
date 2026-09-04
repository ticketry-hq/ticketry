import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { readAgentStatusHolding } from "../features/agents/status/apolloHolding";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import { useTerminalStore } from "../features/agents/terminal";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { fixture, mountStudio, workItem } from "./seam";

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({
    SelectedTicketTerminal: () => <div data-testid="selected-ticket-terminal" />,
  }),
);

const PROJECT = "project-1";
const TASK = "launch-idea";
const RUN = `run-now-${TASK}`;

function controlledStatusTransport() {
  const subscriptions: Array<{
    id: string;
    deliver: (encoded: string) => void;
  }> = [];
  const unsubscribed: string[] = [];
  const proxy = {
    graphql_execute: vi.fn(async () => "{}"),
    graphql_subscribe: vi.fn(async (
      id: string,
      _request: string,
      deliver: (encoded: string) => void,
    ) => {
      subscriptions.push({ id, deliver });
      return '{"type":"accepted"}';
    }),
    graphql_unsubscribe: vi.fn(async (id: string) => {
      unsubscribed.push(id);
      return true;
    }),
  };
  return {
    subscriptions,
    unsubscribed,
    createProxy: () => proxy as never,
    send(frame: unknown) {
      subscriptions.at(-1)?.deliver(JSON.stringify({
        type: "next",
        payload: { data: { run_status_stream: frame } },
      }));
    },
  };
}

describe("overhaul acceptance - acknowledged Agent Run visibility", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    statusStreamFeed.resetCursors(PROJECT);
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  });

  afterEach(() => {
    statusStreamFeed.stop();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("[overhaul-186] selects one authoritative Agent Run before launch acknowledgement", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [TASK, "state-catalog"],
      children: { [TASK]: [], "state-catalog": [] },
      order: [TASK, "state-catalog"],
    });
    http.workItems([
      workItem({
        id: TASK,
        name: "Launch exactly one visible run",
        state: { id: "ideas", name: "Ideas", group: "backlog", color: null },
      }),
      workItem({
        id: "state-catalog",
        name: "Implement state",
        state: {
          id: "implement",
          name: "Implement",
          group: "started",
          color: null,
        },
      }),
    ]);
    const trace = vi.spyOn(console, "info").mockImplementation(() => {});
    const executeGraphQl: typeof http.executeGraphQl = async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "InstantRunTickets") return { tickets: [] } as never;
      if (
        operation === "TaskResumableTerminalSessions" ||
        operation === "ScratchResumableTerminalSessions"
      ) {
        return { resumable_sessions: [] } as never;
      }
      if (operation === "TaskTerminalSessions") {
        return {
          terminal_sessions: { __typename: "AgentTerminalSessionsConnection", sessions: [] },
        } as never;
      }
      if (operation === "WorktreeStatus") {
        return {
          worktree_status: {
            __typename: "WorktreeStatusView",
            kind: "none",
            task_id: TASK,
            top_level_task_id: TASK,
            is_shared: false,
            branch: null,
            base_branch: null,
            path: null,
            state: "none",
            clean: null,
            dirty: null,
            ahead: null,
            behind: null,
            conflict: null,
            checkout_present: false,
            ephemeral: false,
            reason: null,
          },
        } as never;
      }
      return http.executeGraphQl(document, variables);
    };
    mountStudio({
      http,
      selectedTaskId: TASK,
      graphQlExecution: true,
      graphQlExecute: executeGraphQl,
      children: (
        <SelectedTicketContent
          bucket={TASK}
          projectId={PROJECT}
          moduleId="module-1"
          owner="studio"
          details={<div>Launch workspace details</div>}
        />
      ),
    });
    vi.spyOn(studioApolloClient(), "refetchQueries").mockResolvedValue([]);

    const status = controlledStatusTransport();
    statusStreamFeed.start(PROJECT, { createProxy: status.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    expect(status.subscriptions).toHaveLength(1);
    status.send({
      __typename: "RunStatusSnapshot",
      project_id: PROJECT,
      cursor: 10,
      at: "2026-08-31T10:00:00Z",
      runs: [],
      automation_attempts: [],
    });
    status.send({
      __typename: "RunStatusCaughtUp",
      project_id: PROJECT,
      cursor: 10,
    });

    const runNow = await screen.findByRole("button", { name: "Run now" });
    const acknowledge = http.holdRunNow();
    fireEvent.click(runNow);
    fireEvent.click(runNow);
    await vi.advanceTimersByTimeAsync(0);

    expect(http.runNowCount(TASK)).toBe(1);
    expect(runNow).toBeDisabled();
    expect(runNow).toHaveAttribute("aria-busy", "true");
    expect(readAgentStatusHolding().runs[RUN]).toBeUndefined();
    expect(screen.queryAllByRole("tab", { name: /terminal$/ })).toHaveLength(0);

    status.send({
      __typename: "RunStatusEvent",
      cursor: 11,
      event_id: "launch-run-11",
      project_id: PROJECT,
      event_kind: "agent_run.lifecycle",
      payload_version: 1,
      subject_kind: "agent_run",
      subject_id: RUN,
      agent_run_id: RUN,
      automation_attempt_id: null,
      work_item_id: TASK,
      payload: {
        agentRunId: RUN,
        state: "starting",
        effectiveState: "starting",
        occurredAt: "2026-08-31T10:00:01Z",
        run: {
          agent_run_id: RUN,
          project_id: PROJECT,
          task_id: TASK,
          module_id: "module-1",
          agent: "codex",
          scope: "task",
          launch_state: "Implement",
          launch_model: "gpt-5",
          started_at: "2026-08-31T10:00:00Z",
          state: "starting",
          effective_state: "starting",
          updated_at: "2026-08-31T10:00:00Z",
          provider_session_id: null,
          output_sequence: 0,
          last_output_at: null,
        },
      },
      committed_at: "2026-08-31T10:00:01Z",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.values(readAgentStatusHolding().runs)).toEqual([
      expect.objectContaining({ agent_run_id: RUN, state: "starting" }),
    ]);
    expect(runNow).toBeDisabled();
    expect(runNow).toHaveAttribute("aria-busy", "true");
    const pendingTabs = screen.getAllByRole("tab", { name: /terminal$/ });
    expect(pendingTabs).toHaveLength(1);
    expect(pendingTabs[0]).toHaveAttribute("aria-selected", "true");
    const pendingSessionId = useTerminalStore.getState().sessionByRun[RUN];
    expect(
      useTerminalStore.getState().sessions[pendingSessionId]
        ?.viewerAttachmentDeferred,
    ).toBe(true);

    acknowledge();
    await vi.advanceTimersByTimeAsync(0);
    expect(useTerminalStore.getState().sessionByRun[RUN]).toBeTruthy();
    expect(
      useTerminalStore.getState().sessions[pendingSessionId]
        ?.viewerAttachmentDeferred,
    ).toBe(false);
    expect(screen.getAllByRole("tab", { name: /terminal$/ })).toHaveLength(1);

    status.send({
      __typename: "RunStatusEvent",
      cursor: 12,
      event_id: "working-run-12",
      project_id: PROJECT,
      event_kind: "agent_run.lifecycle",
      payload_version: 1,
      subject_kind: "agent_run",
      subject_id: RUN,
      agent_run_id: RUN,
      automation_attempt_id: null,
      work_item_id: TASK,
      payload: {
        agentRunId: RUN,
        state: "working",
        effectiveState: "working",
        occurredAt: "2026-08-31T10:00:02Z",
      },
      committed_at: "2026-08-31T10:00:02Z",
    });
    await vi.advanceTimersByTimeAsync(300);

    const holding = readAgentStatusHolding();
    expect(Object.keys(holding.runs)).toEqual([RUN]);
    expect(holding.runs[RUN]).toMatchObject({
      agent_run_id: RUN,
      state: "working",
      effective_state: "working",
    });
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({ agentRunId: RUN }),
    ]);
    const visibleRuns = screen.getAllByRole("tab", { name: /terminal$/ });
    expect(visibleRuns).toHaveLength(1);
    expect(visibleRuns[0]).toHaveAttribute("aria-selected", "true");
    expect(http.runNowCount(TASK)).toBe(1);
    expect(status.subscriptions).toHaveLength(1);
    expect(status.unsubscribed).toHaveLength(0);
    expect(trace.mock.calls).not.toContainEqual([
      "[launch-discovery]",
      expect.objectContaining({ event: "unknown-run-resync-scheduled" }),
    ]);
  });
});
