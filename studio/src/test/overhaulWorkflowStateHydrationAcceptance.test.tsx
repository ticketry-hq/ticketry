import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import { getStatesSnapshot, seedStates } from "../features/projects";
import type { State } from "../features/workflows";
import { StateCatalog } from "../features/workflows/StateCatalog";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { studioApolloClient } from "../shared/apollo/client";
import { projectOpenFixture } from "./projectOpenFixture";

const PROJECT = "11111111-1111-1111-1111-111111111111";

function state(id: string, name: string, sort_order: number): State {
  return { id, name, sort_order, project: PROJECT, group: "started", color: "#08BDBA",
    is_protected: true, created_at: "2026-10-10T09:00:00Z", updated_at: "2026-10-12T10:00:00Z" };
}

afterEach(() => {
  statusStreamFeed.stop();
  statusStreamFeed.resetCursors(PROJECT);
  vi.restoreAllMocks();
});

describe("workflow catalog hydration acceptance", () => {
  it("[overhaul-468] displays a newly created state after another state is renamed during hydration", async () => {
    const originalA = state("state-a", "Existing", 0);
    const renamedA = { ...originalA, name: "Renamed Existing" };
    const createdB = state("state-b", "New State", 1);
    seedStates(PROJECT, [originalA]);
    useWorkflowEditorStore.setState(useWorkflowEditorStore.getInitialState(), true);
    useWorkflowEditorStore.setState({ projectId: PROJECT, states: [originalA] });
    render(<StateCatalog />);
    expect(screen.getByRole("listitem", { name: "Existing state" })).toBeVisible();

    const base = projectOpenFixture({ id: PROJECT, name: "Project", slug: "TEST", description: "", created_at: "2026-10-10T09:00:00Z" }, []).data;
    const catalog = (states: State[]) => ({ data: { ...base,
      states: { __typename: "WorktrackerStateConnection", nodes: states.map((row) => ({ __typename: "WorktrackerState", ...row })) },
    } });
    let resolveRead!: (value: ReturnType<typeof catalog>) => void;
    const pending = new Promise<ReturnType<typeof catalog>>((resolve) => { resolveRead = resolve; });
    const query = vi.spyOn(studioApolloClient(), "query")
      .mockImplementationOnce(() => pending as never)
      .mockResolvedValue(catalog([renamedA, createdB]) as never);
    let deliver!: (encoded: string) => void;
    const proxy = {
      graphql_execute: vi.fn(async () => "{}"),
      graphql_subscribe: vi.fn(async (_id: string, _request: string, onEvent: (value: string) => void) => {
        deliver = onEvent;
        return '{"type":"accepted"}';
      }),
      graphql_unsubscribe: vi.fn(async () => true),
    };
    statusStreamFeed.start(PROJECT, { createProxy: () => proxy as never });
    await waitFor(() => expect(proxy.graphql_subscribe).toHaveBeenCalled());
    const publish = (cursor: number, row: State) => act(() => deliver(JSON.stringify({ type: "next", payload: { data: {
      run_status_stream: {
        __typename: "RunStatusEvent", cursor, event_id: `event-${cursor}`, project_id: PROJECT,
        event_kind: "workflow_state.changed", payload_version: 1, subject_kind: "workflow_state", subject_id: row.id,
        agent_run_id: null, automation_attempt_id: null, work_item_id: null,
        payload: { stateId: row.id, state: { id: row.id, name: row.name, group: row.group, color: row.color, sort_order: row.sort_order } },
        committed_at: "2026-10-12T10:00:00Z",
      },
    } } })));

    publish(11, createdB);
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("listitem", { name: "New State state" })).toBeNull();
    publish(12, renamedA);
    await screen.findByRole("listitem", { name: "Renamed Existing state" });
    await act(async () => resolveRead(catalog([originalA, createdB])));

    await waitFor(() => {
      expect(screen.getByRole("listitem", { name: "New State state" })).toBeVisible();
      expect(screen.getByRole("listitem", { name: "Renamed Existing state" })).toBeVisible();
      expect(screen.queryByRole("listitem", { name: "Existing state" })).toBeNull();
    });
    expect(getStatesSnapshot(PROJECT)).toEqual([
      { __typename: "WorktrackerState", ...renamedA },
      { __typename: "WorktrackerState", ...createdB },
    ]);
  });
});
