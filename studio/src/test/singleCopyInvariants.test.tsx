import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItem } from "../shared/api/types";
import * as api from "../shared/api/client";
import { queryKeys } from "../shared/query/keys";
import { useClientStore } from "../state/clientStore";
import { useAgentStatusStore } from "../features/agents/status/store";
import { useRenameWorkItem } from "../features/work-items/mutations";
import NameEditor from "../app/shell/ticket-workspace/selected-ticket/details/NameEditor";
import {
  findDuplicateWorkItemHoldings,
  findRunFieldOverlaps,
  serializeWithCollections,
} from "./singleCopyInvariants";

vi.mock("../features/agents/terminal", () => ({ focusTerminal: vi.fn() }));

const OLD_NAME = "Invariant old name";
const NEW_NAME = "Invariant new name";

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "story-1",
    name: OLD_NAME,
    project_id: "project-1",
    sequence_id: 1,
    state: null,
    state_revision: 1,
    description: "",
    parent_id: "module-1",
    sub_issues_count: 0,
    key: "MEML-1",
    is_archived: false,
    created_at: "2026-08-06T12:00:00Z",
    updated_at: "2026-08-06T12:00:00Z",
    rank: "a",
    issue_type: {
      id: "story",
      name: "Story",
      level: "task",
      color: null,
      sort_order: 1,
    },
    blocked_by_ids: [],
    blocks_ids: [],
    ...overrides,
  };
}

function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function RenameHarness({ id }: { id: string }) {
  const client = useQueryClient();
  const rename = useRenameWorkItem();
  const current = client.getQueryData<WorkItem>(queryKeys.workItems.byId(id))!;
  return (
    <NameEditor
      name={current.name}
      saving={rename.isPending}
      onSave={(name) => rename.mutate({ id, name })}
    />
  );
}

function Wrapper({ client, children }: PropsWithChildren<{ client: QueryClient }>) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useClientStore.setState({
    storySearchQuery: "",
    modalStack: [],
    dialogs: [],
    toasts: [],
    selection: { surface: null, ids: new Set(), anchorId: null },
  });
  useAgentStatusStore.setState({
    projectId: null,
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
  vi.restoreAllMocks();
});

describe("deliberate architectural exception: single-copy invariants", () => {
  it("walks the whole client store after a rename commits and its draft clears", async () => {
    const client = testClient();
    const original = workItem();
    client.setQueryData(queryKeys.workItems.byId(original.id), original);
    vi.spyOn(api, "patchWorkItem").mockResolvedValue(
      workItem({ name: NEW_NAME, updated_at: "2026-08-06T12:01:00Z" }),
    );
    render(
      <Wrapper client={client}>
        <RenameHarness id={original.id} />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId("issue-name"));
    const draft = screen.getByRole("textbox");
    fireEvent.change(draft, { target: { value: NEW_NAME } });
    fireEvent.keyDown(draft, { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    await waitFor(() => expect(screen.queryByText("saving…")).toBeNull());
    expect(api.patchWorkItem).toHaveBeenCalledWith(original.id, { name: NEW_NAME });
    await waitFor(() =>
      expect(client.getQueryData<WorkItem>(queryKeys.workItems.byId(original.id))?.name)
        .toBe(NEW_NAME),
    );

    const blob = serializeWithCollections(useClientStore.getState());
    expect(blob).not.toContain(OLD_NAME);
    expect(blob).not.toContain(NEW_NAME);
    expect(serializeWithCollections({
      set: new Set(["set-expanded"]),
      map: new Map([["map-key", "map-expanded"]]),
    })).toContain("set-expanded");
    expect(serializeWithCollections({
      map: new Map([["map-key", "map-expanded"]]),
    })).toContain("map-expanded");
  });

  it("walks every cache entry and holds each work-item record once", () => {
    const client = testClient();
    const item = workItem();
    client.setQueryData(queryKeys.workItems.byId(item.id), item);
    client.setQueryData(queryKeys.tasks.byModule(item.project_id, "module-1"), {
      rootIds: [item.id],
      children: { [item.id]: [] },
      order: [item.id],
    });

    expect(findDuplicateWorkItemHoldings(client.getQueryCache().getAll())).toEqual([]);
  });

  it("holds no non-identity run field in both a cache entry and the run projection", () => {
    const client = testClient();
    const run = {
      agent_run_id: "run-1",
      project_id: "project-1",
      task_id: "story-1",
      module_id: "module-1",
      agent: "codex",
      scope: "task" as const,
      started_at: "2026-08-06T12:00:00Z",
      state: "working" as const,
      updated_at: "2026-08-06T12:01:00Z",
    };
    useAgentStatusStore.getState().upsertRun(run);
    client.setQueryData(queryKeys.terminalSessions.persisted("story-1"), [{
      agent_run_id: run.agent_run_id,
      tmux_session_name: `pt-${run.agent_run_id}`,
      created_at: "2026-08-06T12:00:00Z",
    }]);

    expect(
      findRunFieldOverlaps(
        client.getQueryCache().getAll(),
        useAgentStatusStore.getState().runs,
      ),
    ).toEqual([]);
  });
});
