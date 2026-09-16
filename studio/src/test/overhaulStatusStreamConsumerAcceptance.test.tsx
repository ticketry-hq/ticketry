/**
 * Formerly manual: reconnect the app after losing the network, edit a work
 * item from another window, rename a workflow state, and confirm every open
 * surface converges without a manual reload — while an in-flight local edit is
 * never painted over.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { studioApolloClient } from "../shared/apollo/client";
import { getStatesSnapshot, seedStates } from "../features/projects";
import {
  AgentStateBadge,
  AutomationFailureChicklet,
} from "../features/agents/lifecycle";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import {
  ScratchDocumentRegistryDocument,
  TaskDocumentRegistryDocument,
} from "../features/documents/generated/documentRegistry.documents";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import ToastHost from "../app/shell/ToastHost";
import { useClientStore } from "../state/clientStore";
import { recordLocalWorkItemConvergence } from "../features/work-items/workItemConvergence";
import { WorkTrackerModuleOpenDocument } from "../features/work-items";
import { seedModuleOpenFixture } from "./projectOpenFixture";
import { workItem } from "./seam";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "22222222-2222-2222-2222-222222222222";

function transport() {
  const subscriptions: {
    id: string;
    variables: { projectId: string; afterCursor: number | null };
    deliver: (encoded: string) => void;
  }[] = [];
  const proxy = {
    graphql_execute: vi.fn(async () => "{}"),
    graphql_subscribe: vi.fn(
      async (id: string, request: string, onEvent: (value: string) => void) => {
        subscriptions.push({
          id,
          variables: JSON.parse(request).variables,
          deliver: onEvent,
        });
        return '{"type":"accepted"}';
      },
    ),
    graphql_unsubscribe: vi.fn(async () => true),
  };
  const send = (frame: unknown, at = subscriptions.length - 1) =>
    subscriptions[at].deliver(
      JSON.stringify({
        type: "next",
        payload: { data: { run_status_stream: frame } },
      }),
    );
  return { subscriptions, send, proxy, createProxy: () => proxy as never };
}

const durableEvent = (
  cursor: number,
  event_kind: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  __typename: "RunStatusEvent",
  cursor,
  event_id: `event-${cursor}`,
  project_id: PROJECT,
  event_kind,
  payload_version: 1,
  subject_kind: "work_item",
  subject_id: "subject",
  agent_run_id: null,
  automation_attempt_id: null,
  work_item_id: null,
  payload,
  committed_at: "2026-08-16T10:05:00+00:00",
  ...overrides,
});

function statusRun(overrides: Record<string, unknown> = {}) {
  return {
    agent_run_id: "run-1",
    project_id: PROJECT,
    task_id: "task-1",
    module_id: "module-1",
    agent: "codex",
    scope: "task",
    launch_state: "Implement",
    launch_model: "gpt-5",
    started_at: "2026-08-16T09:00:00+00:00",
    state: "working",
    effective_state: "working",
    updated_at: "2026-08-16T09:00:00+00:00",
    provider_session_id: null,
    output_sequence: 0,
    last_output_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  statusStreamFeed.resetCursors(PROJECT);
  statusStreamFeed.resetCursors(OTHER_PROJECT);
  useAgentStatusStore.setState({
    projectId: null,
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
  useClientStore.setState({ toasts: [] });
});

afterEach(() => {
  statusStreamFeed.stop();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("durable status consumer acceptance", () => {
  it("[overhaul-268] skips a mutation's matching event while fetching a later external edit", async () => {
    const server = transport();
    const client = studioApolloClient();
    const query = vi.spyOn(client, "query").mockResolvedValue({} as never);
    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    recordLocalWorkItemConvergence("item-1", "2026-09-05 00:00:00.123456");
    server.send(durableEvent(11, "work_item.changed", {
      workItemId: "item-1", projectId: PROJECT, moduleId: "module-a",
      membershipChanged: true, occurredAt: "2026-09-05T00:00:00.123456+00:00",
    }));
    await vi.advanceTimersByTimeAsync(60);
    expect(query).not.toHaveBeenCalled();
    server.send(durableEvent(12, "work_item.changed", {
      workItemId: "item-1", projectId: PROJECT, moduleId: "module-a",
      membershipChanged: true, occurredAt: "2026-09-05T00:00:00.123457Z",
    }));
    await vi.advanceTimersByTimeAsync(60);
    expect(query.mock.calls.map(([options]) => options?.variables)).toEqual([
      { id: "item-1" }, { moduleId: "module-a" },
    ]);
  });

  it("[overhaul-266] refreshes both modules after an external cross-module move", async () => {
    const server = transport();
    seedModuleOpenFixture("module-a", [workItem({
      id: "item-1",
      project_id: PROJECT,
      parent_id: "module-a",
    })]);
    const query = vi.spyOn(studioApolloClient(), "query")
      .mockResolvedValue({} as never);

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    server.send(durableEvent(11, "work_item.changed", {
      workItemId: "item-1",
      projectId: PROJECT,
      moduleId: "module-b",
      membershipChanged: true,
    }));
    await vi.advanceTimersByTimeAsync(60);

    const refreshedModules = query.mock.calls
      .filter(([options]) => options?.query === WorkTrackerModuleOpenDocument)
      .map(([options]) => options?.variables?.moduleId)
      .sort();
    expect(refreshedModules).toEqual(["module-a", "module-b"]);
  });

  it("[overhaul-275] restores run status with a fresh subscription identity after reload", async () => {
    const server = transport();

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    expect(server.subscriptions).toHaveLength(1);
    expect(server.subscriptions[0].id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    // A reload loses the client counter but the native host can still hold
    // the previous document's subscription. A new feed must not reuse its id.
    statusStreamFeed.stop();
    useAgentStatusStore.setState({ projectId: null, runs: {} });
    statusStreamFeed.resetCursors(PROJECT);
    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    expect(server.subscriptions).toHaveLength(2);
    expect(server.subscriptions[1].id).not.toBe(server.subscriptions[0].id);
    server.send({
      __typename: "RunStatusSnapshot", project_id: PROJECT, cursor: 10,
      at: "2026-08-16T10:00:00Z", runs: [statusRun()], automation_attempts: [],
    });
    expect(useAgentStatusStore.getState().runs["run-1"]?.state).toBe("working");
  });

  it("retries a refused subscription and restores the live holding", async () => {
    const server = transport();
    server.proxy.graphql_subscribe.mockResolvedValueOnce(JSON.stringify({
      errors: [{ message: "The subscription id is already active." }],
    }));
    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.proxy.graphql_subscribe).toHaveBeenCalledTimes(2);
    server.send({
      __typename: "RunStatusSnapshot", project_id: PROJECT, cursor: 10,
      at: "2026-08-16T10:00:00Z", runs: [statusRun()], automation_attempts: [],
    });
    expect(useAgentStatusStore.getState().runs["run-1"]?.state).toBe("working");
  });

  it("[overhaul-229] drops terminal history from task badges and quietly announces new losses", async () => {
    const server = transport();
    render(
      <>
        <AgentStateBadge issueId="task-1" />
        <ToastHost />
      </>,
    );

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    act(() => {
      server.send({
        __typename: "RunStatusSnapshot",
        project_id: PROJECT,
        cursor: 10,
        at: "2026-08-16T10:00:00+00:00",
        runs: [
          statusRun({ agent_run_id: "run-1" }),
          statusRun({ agent_run_id: "run-2" }),
          statusRun({
            agent_run_id: "historical-loss",
            state: "lost",
            effective_state: "lost",
          }),
        ],
        automation_attempts: [],
      });
    });

    expect(screen.getByTestId("agent-state-badge")).toHaveTextContent("▶2");
    expect(screen.queryByTestId("toast-info")).not.toBeInTheDocument();

    // Replayed loss history before caught-up is silent.
    act(() => {
      server.send(durableEvent(
        11,
        "agent_run.terminal",
        {
          agentRunId: "historical-loss",
          state: "lost",
          occurredAt: "2026-08-16T10:01:00+00:00",
        },
        { subject_kind: "agent_run", agent_run_id: "historical-loss" },
      ));
      server.send({
        __typename: "RunStatusCaughtUp",
        project_id: PROJECT,
        cursor: 11,
      });
    });
    expect(screen.queryByTestId("toast-info")).not.toBeInTheDocument();

    await act(async () => {
      for (const [cursor, agentRunId] of [[12, "run-1"], [13, "run-2"]] as const) {
        server.send(durableEvent(
          cursor,
          "agent_run.terminal",
          {
            agentRunId,
            state: "lost",
            occurredAt: `2026-08-16T10:0${cursor - 10}:00+00:00`,
          },
          { subject_kind: "agent_run", agent_run_id: agentRunId },
        ));
      }
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.queryByTestId("agent-state-badge")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("toast-info")).toHaveLength(1);
    expect(screen.getByTestId("toast-info")).toHaveTextContent(
      "2 terminal sessions closed. You can resume them from terminal history.",
    );
  });

  it("[overhaul-278] carries live runs only and summarises each snapshot in one record", async () => {
    const trace = vi.spyOn(console, "info").mockImplementation(() => {});
    const server = transport();
    const snapshot = (cursor: number, runs: unknown[]) => ({
      __typename: "RunStatusSnapshot",
      project_id: PROJECT,
      cursor,
      at: "2026-08-16T10:00:00+00:00",
      runs,
      automation_attempts: [],
    });

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    act(() => {
      server.send(snapshot(10, [
        statusRun({ agent_run_id: "run-1" }),
        statusRun({ agent_run_id: "run-2" }),
        statusRun({ agent_run_id: "run-3" }),
      ]));
    });
    expect(Object.keys(useAgentStatusStore.getState().runs).sort())
      .toEqual(["run-1", "run-2", "run-3"]);

    // A live run reaching a terminal outcome updates in place, through its
    // own event, while it is still held.
    act(() => {
      server.send(durableEvent(
        11,
        "agent_run.terminal",
        {
          agentRunId: "run-1",
          state: "exited",
          occurredAt: "2026-08-16T10:01:00+00:00",
        },
        { subject_kind: "agent_run", agent_run_id: "run-1" },
      ));
    });
    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("exited");

    // A reconnect or visibility restore delivers a fresh live-only snapshot.
    // `run-1` has ended and `run-2` ended while this client was away: both
    // leave the live holding, and neither is fabricated as exited.
    act(() => {
      server.send(snapshot(12, [statusRun({ agent_run_id: "run-3" })]));
    });
    expect(Object.keys(useAgentStatusStore.getState().runs)).toEqual(["run-3"]);
    expect(useAgentStatusStore.getState().runs["run-3"].state).toBe("working");

    // Two snapshots cost two summary records each, not one pair per run. Each
    // console line is one main-thread IPC invoke under desktop file logging.
    const snapshotRecords = trace.mock.calls
      .filter(([label]) => label === "[launch-discovery]")
      .map(([, record]) => record as Record<string, unknown>)
      .filter((record) =>
        record.frameType === "snapshot" || record.source === "snapshot"
      );
    expect(snapshotRecords.map((record) => [record.event, record.runCount]))
      .toEqual([
        ["graphql-frame-received", 3],
        ["apollo-run-applied", 3],
        ["graphql-frame-received", 1],
        ["apollo-run-applied", 1],
      ]);
    expect(snapshotRecords.every((record) => record.agentRunId === null))
      .toBe(true);
  });

  it("[overhaul-82c] applies the durable status subscription in browser Studio", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream({
        start(controller) {
          stream = controller;
        },
      }), { status: 200 }),
    );
    const runtime = createBrowserRuntime({ environment: {} });
    const createProxy = runtime.statusStream();
    expect(createProxy).not.toBeNull();
    render(
      <>
        <AgentStateBadge issueId="task-1" />
        <AutomationFailureChicklet issueId="task-1" />
      </>,
    );

    statusStreamFeed.start(PROJECT, { createProxy: createProxy! });
    await vi.advanceTimersByTimeAsync(0);
    await act(async () => {
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
        type: "next",
        payload: {
          data: {
            run_status_stream: {
              __typename: "RunStatusSnapshot",
              project_id: PROJECT,
              cursor: 1,
              at: "2026-08-16T10:00:00+00:00",
              runs: [{
                agent_run_id: "browser-run",
                project_id: PROJECT,
                task_id: "task-1",
                module_id: "module-1",
                agent: "codex",
                scope: "task",
                launch_state: "Ideas",
                launch_model: null,
                started_at: "2026-08-16T09:00:00+00:00",
                state: "working",
                effective_state: "working",
                updated_at: "2026-08-16T09:00:00+00:00",
                provider_session_id: null,
                output_sequence: 0,
                last_output_at: null,
              }],
              automation_attempts: [{
                attempt_id: "attempt-1",
                root_attempt_id: "attempt-1",
                retry_of_attempt_id: null,
                work_item_id: "task-1",
                status: "pending",
                error: null,
                failure: null,
                retryable: true,
                agent_run_id: "browser-run",
                updated_at: "2026-08-16T09:01:00+00:00",
              }],
            },
          },
        },
      })}\n\n`));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useAgentStatusStore.getState().runs["browser-run"].state).toBe("working");
    expect(screen.getByTestId("agent-state-badge")).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.queryByTestId("automation-failure-chicklet"))
      .not.toBeInTheDocument();

    await act(async () => {
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
        type: "next",
        payload: {
          data: {
            run_status_stream: {
              __typename: "RunStatusSnapshot",
              project_id: PROJECT,
              cursor: 2,
              at: "2026-08-16T10:01:00+00:00",
              runs: [],
              automation_attempts: [{
                attempt_id: "attempt-1",
                root_attempt_id: "attempt-1",
                retry_of_attempt_id: null,
                work_item_id: "task-1",
                status: "failed",
                error: "Provider exited before launch",
                failure: null,
                retryable: false,
                agent_run_id: "browser-run",
                updated_at: "2026-08-16T09:02:00+00:00",
              }],
            },
          },
        },
      })}\n\n`));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId("automation-failure-chicklet"))
      .toHaveTextContent("!1Fix required");
    expect(fetch).toHaveBeenCalledWith(
      "/graphql/subscribe",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("[overhaul-82b] updates terminal discovery from ProjectRunStatus without a second read", async () => {
    const server = transport();
    const refetch = vi.spyOn(studioApolloClient(), "refetchQueries")
      .mockResolvedValue([]);

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    server.send({
      __typename: "RunStatusSnapshot",
      project_id: PROJECT,
      cursor: 10,
      at: "2026-08-16T10:00:00+00:00",
      runs: [{
        agent_run_id: "run-1",
        project_id: PROJECT,
        task_id: "task-1",
        module_id: "module-1",
        agent: "codex",
        scope: "task",
        launch_state: "Ideas",
        launch_model: null,
        started_at: "2026-08-16T09:00:00+00:00",
        state: "working",
        effective_state: "working",
        updated_at: "2026-08-16T09:00:00+00:00",
        provider_session_id: null,
        output_sequence: 0,
        last_output_at: null,
      }],
      automation_attempts: [],
    });
    refetch.mockClear();

    server.send(durableEvent(
      11,
      "agent_run.terminal_activity",
      {
        type: "terminal_activity",
        at: "2026-08-16T10:01:00+00:00",
        run: {
          agent_run_id: "run-1",
          project_id: PROJECT,
          task_id: "task-1",
          module_id: "module-1",
          agent: "codex",
          scope: "task",
          launch_state: "Ideas",
          launch_model: null,
          started_at: "2026-08-16T09:00:00+00:00",
          state: "working",
          effective_state: "working",
          updated_at: "2026-08-16T10:01:00+00:00",
          provider_session_id: "provider-session",
          output_sequence: 1,
          last_output_at: "2026-08-16T10:01:00+00:00",
        },
      },
      { subject_kind: "agent_run", agent_run_id: "run-1" },
    ));

    expect(useAgentStatusStore.getState().runs["run-1"]).toMatchObject({
      output_sequence: 1,
      last_output_at: "2026-08-16T10:01:00+00:00",
    });
    expect(refetch).not.toHaveBeenCalled();
  });

  it("[overhaul-82] converges runs, work items, and workflow states across disconnect, reconnect, and project switch", async () => {
    const server = transport();
    seedStates(PROJECT, [
      {
        id: "state-1",
        name: "Backlog",
        group: "backlog",
        color: "#111111",
        sort_order: 0,
      } as never,
    ]);
    const itemRefresh = vi.spyOn(studioApolloClient(), "query")
      .mockResolvedValue({} as never);
    const refetch = vi.spyOn(studioApolloClient(), "refetchQueries")
      .mockResolvedValue([] as never);

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    server.send({
      __typename: "RunStatusSnapshot",
      project_id: PROJECT,
      cursor: 10,
      at: "2026-08-16T10:00:00+00:00",
      runs: [
        {
          agent_run_id: "run-1",
          project_id: PROJECT,
          task_id: "task-1",
          module_id: "module-1",
          agent: "codex",
          scope: "task",
          started_at: "2026-08-16T09:00:00+00:00",
          state: "working",
          updated_at: "2026-08-16T09:00:00+00:00",
          provider_session_id: null,
        },
      ],
      automation_attempts: [],
    });
    server.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 10 });
    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("working");

    // A workflow rename from another window reaches the one cached catalog.
    server.send(
      durableEvent(11, "workflow_state.changed", {
        stateId: "state-1",
        state: {
          id: "state-1",
          name: "Ready",
          group: "unstarted",
          color: "#333333",
          sort_order: 0,
        },
      }),
    );
    expect(getStatesSnapshot(PROJECT)[0].name).toBe("Ready");

    // Apollo's optimistic layer remains above concurrent authoritative reads.
    itemRefresh.mockClear();
    server.send(
      durableEvent(12, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(itemRefresh).toHaveBeenCalledWith(expect.objectContaining({
      variables: { id: "item-1" },
    }));

    // A membership change refreshes the item and its containing collection.
    itemRefresh.mockClear();
    server.send(
      durableEvent(13, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(itemRefresh).toHaveBeenCalledWith(expect.objectContaining({
      variables: { id: "item-1" },
    }));

    // Losing the network and coming back resumes from the retained cursor and
    // refreshes the capabilities that are not carried by the outbox.
    itemRefresh.mockClear();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.subscriptions).toHaveLength(2);
    expect(server.subscriptions[1].variables.afterCursor).toBe(13);
    server.send({ __typename: "RunStatusCaughtUp", project_id: PROJECT, cursor: 13 });
    expect(refetch).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.arrayContaining([
        TaskDocumentRegistryDocument,
        ScratchDocumentRegistryDocument,
      ]),
    }));

    // A terminal outcome delivered after reconnect is authoritative.
    server.send(
      durableEvent(
        14,
        "agent_run.terminal",
        {
          agentRunId: "run-1",
          state: "exited",
          occurredAt: "2026-08-16T11:00:00+00:00",
        },
        { subject_kind: "agent_run", agent_run_id: "run-1" },
      ),
    );
    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("exited");

    // Switching projects drops everything still queued from the old one.
    statusStreamFeed.start(OTHER_PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);
    server.send(
      durableEvent(15, "work_item.changed", {
        workItemId: "item-1",
        membershipChanged: true,
      }),
      1,
    );
    await vi.advanceTimersByTimeAsync(60);
    expect(itemRefresh).not.toHaveBeenCalled();
  });
});
