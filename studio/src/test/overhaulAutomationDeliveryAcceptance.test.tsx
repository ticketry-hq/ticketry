/**
 * Formerly manual: move a Story across a handoff edge, then across an ordinary
 * automated edge, and confirm the open Stories pane says which of the two the
 * transition did — continued the live agent session, or started a fresh one.
 *
 * A continued handoff mints no run and settles its Automation Attempt in the
 * same breath, so nothing else on the row tells the two apart: the attempt's
 * durable delivery mode is the only evidence, and it has to reach the screen.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutomationDeliveryChicklet } from "../features/agents/lifecycle";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const STORY = "22222222-2222-2222-2222-222222222222";

function transport() {
  const subscriptions: { deliver: (encoded: string) => void }[] = [];
  const proxy = {
    graphql_execute: vi.fn(async () => "{}"),
    graphql_subscribe: vi.fn(
      async (_id: string, _request: string, onEvent: (value: string) => void) => {
        subscriptions.push({ deliver: onEvent });
        return '{"type":"accepted"}';
      },
    ),
    graphql_unsubscribe: vi.fn(async () => true),
  };
  const send = (frame: unknown) =>
    subscriptions[subscriptions.length - 1].deliver(
      JSON.stringify({
        type: "next",
        payload: { data: { run_status_stream: frame } },
      }),
    );
  return { send, createProxy: () => proxy as never };
}

/** The durable fact a delivered transition publishes on the status feed. */
const deliveryFrame = (
  cursor: number,
  mode: "continued" | "started_fresh",
  overrides: Record<string, unknown> = {},
) => ({
  __typename: "RunStatusEvent",
  cursor,
  event_id: `event-${cursor}`,
  project_id: PROJECT,
  event_kind: "automation_attempt_delivery",
  payload_version: 1,
  subject_kind: "automation_attempt",
  subject_id: `attempt-${cursor}`,
  agent_run_id: "run-1",
  automation_attempt_id: `attempt-${cursor}`,
  work_item_id: STORY,
  payload: {
    attempt_id: `attempt-${cursor}`,
    root_attempt_id: `attempt-${cursor}`,
    retry_of_attempt_id: null,
    work_item_id: STORY,
    // A continued handoff succeeds the moment typed delivery lands.
    status: "succeeded",
    error: null,
    failure: null,
    retryable: false,
    agent_run_id: "run-1",
    delivery_mode: mode,
    updated_at: `2026-09-01T1${cursor}:00:00+00:00`,
    ...overrides,
  },
  committed_at: `2026-09-01T1${cursor}:00:00+00:00`,
});

beforeEach(() => {
  vi.useFakeTimers();
  statusStreamFeed.resetCursors(PROJECT);
  useAgentStatusStore.setState({
    projectId: PROJECT,
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
});

afterEach(() => {
  statusStreamFeed.stop();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("automated transition delivery acceptance", () => {
  it("[overhaul-250] says whether an automated transition continued the live session or started a fresh one", async () => {
    const server = transport();
    render(<AutomationDeliveryChicklet issueId={STORY} />);

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    // Nothing has been delivered, so the row stays silent rather than
    // guessing at a mode.
    expect(screen.queryByTestId("automation-delivery-chicklet")).toBeNull();

    await act(async () => {
      server.send(deliveryFrame(1, "continued"));
      await vi.advanceTimersByTimeAsync(0);
    });

    const continued = screen.getByTestId("automation-delivery-chicklet");
    expect(continued).toHaveAttribute("data-delivery-mode", "continued");
    expect(continued).toHaveTextContent("Continued");
    expect(continued).toHaveTextContent(
      "This transition continued the Story's existing agent session.",
    );

    // The next transition down the workflow spawned its own session; the row
    // has to follow it rather than retaining the earlier handoff.
    await act(async () => {
      server.send(deliveryFrame(2, "started_fresh"));
      await vi.advanceTimersByTimeAsync(0);
    });

    const fresh = screen.getByTestId("automation-delivery-chicklet");
    expect(fresh).toHaveAttribute("data-delivery-mode", "started_fresh");
    expect(fresh).toHaveTextContent("Fresh");
    expect(fresh).toHaveTextContent(
      "This transition started a fresh agent session.",
    );
  });

  it("[overhaul-236b] rolls a descendant's delivery up to the collapsed parent row", async () => {
    const server = transport();
    const child = "33333333-3333-3333-3333-333333333333";
    render(<AutomationDeliveryChicklet issueId={STORY} descendantIds={[child]} />);

    statusStreamFeed.start(PROJECT, { createProxy: server.createProxy });
    await vi.advanceTimersByTimeAsync(0);

    await act(async () => {
      server.send({
        ...deliveryFrame(1, "continued"),
        work_item_id: child,
        payload: { ...deliveryFrame(1, "continued").payload, work_item_id: child },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId("automation-delivery-chicklet")).toHaveAttribute(
      "data-delivery-mode",
      "continued",
    );
  });
});
