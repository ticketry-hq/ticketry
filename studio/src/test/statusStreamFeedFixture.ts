/**
 * A hand-driven `run_status_stream` transport for acceptance tests: the feed
 * subscribes through the real `statusStreamFeed`, and the test pushes
 * `work_item.changed` facts so the real fact-invalidation path refetches.
 */
import { vi } from "vitest";

export function statusFeedTransport() {
  const deliveries: Array<(encoded: string) => void> = [];
  const proxy = {
    graphql_execute: vi.fn(async () => "{}"),
    graphql_subscribe: vi.fn(
      async (_id: string, _request: string, onEvent: (value: string) => void) => {
        deliveries.push(onEvent);
        return '{"type":"accepted"}';
      },
    ),
    graphql_unsubscribe: vi.fn(async () => true),
  };
  return {
    ready: () => deliveries.length > 0,
    send: (frame: unknown) =>
      deliveries[deliveries.length - 1](JSON.stringify({
        type: "next",
        payload: { data: { run_status_stream: frame } },
      })),
    createProxy: () => proxy as never,
  };
}

let cursor = 100;

/** Rewind the fact cursor so each test starts from the same sequence. */
export function resetFactCursor(): void {
  cursor = 100;
}

export function workItemChangedFact(
  projectId: string,
  workItemId: string,
  payload: Record<string, unknown> = {},
) {
  return {
    __typename: "RunStatusEvent",
    cursor: ++cursor,
    event_id: `event-${cursor}`,
    project_id: projectId,
    event_kind: "work_item.changed",
    payload_version: 1,
    subject_kind: "work_item",
    subject_id: workItemId,
    agent_run_id: null,
    automation_attempt_id: null,
    work_item_id: workItemId,
    payload: { workItemId, projectId, moduleId: "module-1", ...payload },
    committed_at: "2026-09-05T10:00:00+00:00",
  };
}
