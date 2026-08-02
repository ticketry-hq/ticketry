import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>("../shared/api/client");
  return {
    ...actual,
    listProjectWorkItems: vi.fn(),
    listStates: vi.fn(),
  };
});

import * as api from "../shared/api/client";
import type { State, WorkItem } from "../shared/api/types";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { useIssueDrawerWorkspaceStore } from "../features/work-items/issue-detail/internal/drawerWorkspaceStore";
import { useIssueStore } from "../features/work-items/issue-detail/internal/issueStore";

const TODO: State = { id: "todo", name: "Todo", group: "unstarted", color: null };

function item(partial: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "item-1",
    key: "MEML-1",
    name: "Canonical item",
    project_id: "project-1",
    sequence_id: 1,
    state: TODO,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    is_archived: false,
    ...partial,
    issue_type: partial.issue_type ?? { id: "type-task", name: "Task", level: "task" },
  };
}

beforeEach(() => {
  vi.mocked(api.listProjectWorkItems).mockReset();
  vi.mocked(api.listStates).mockReset();
  useIssueStore.setState({
    workItemsById: {},
    workItemIdByKey: {},
    childWorkItemIds: {},
    seenStateRevisions: {},
    pendingStateDeltas: {},
  });
  useBacklogStore.setState({
    projectId: null,
    itemIds: [],
    states: [],
    loading: false,
    error: null,
    loadError: null,
  });
  useIssueDrawerWorkspaceStore.getState().reset();
});

describe("canonical backlog and drawer work-item ownership", () => {
  it("keeps backlog membership as ids while preserving the complete canonical record", async () => {
    const loaded = item({ blocked_by_ids: ["other"] });
    vi.mocked(api.listProjectWorkItems).mockResolvedValue([loaded]);
    vi.mocked(api.listStates).mockResolvedValue([TODO]);

    await useBacklogStore.getState().loadBacklog("project-1");

    expect(useBacklogStore.getState().itemIds).toEqual([loaded.id]);
    expect(useIssueStore.getState().getWorkItem(loaded.id)).toMatchObject({
      blocked_by_ids: ["other"],
      created_at: "2026-01-01T00:00:00Z",
    });
  });

  it("updates the backlog and drawer's resolved record through one owner", () => {
    const original = item();
    useIssueStore.getState().hydrateWorkItems([original]);
    useBacklogStore.setState({ projectId: original.project_id, itemIds: [original.id] });
    useIssueDrawerWorkspaceStore.setState({
      byIssueKey: {
        [original.key]: {
          issueKey: original.key,
          taskId: original.id,
          projectId: original.project_id,
          module: null,
          profile: { status: "idle", error: null, profile: null },
          launchContext: null,
          loading: false,
          error: null,
        },
      },
    });

    useBacklogStore.getState().applyServerItem(item({ name: "Updated once", state: null }));

    const drawerId = useIssueDrawerWorkspaceStore.getState().byIssueKey[original.key].taskId;
    expect(useBacklogStore.getState().itemIds).toEqual([original.id]);
    expect(drawerId).toBe(original.id);
    expect(useIssueStore.getState().getWorkItem(drawerId!)?.name).toBe("Updated once");
    expect(useIssueStore.getState().getWorkItem(drawerId!)?.state).toBeNull();
  });

  it("retains id membership while a state-feed delta updates the canonical record", () => {
    const original = item({ state_revision: 1 });
    useIssueStore.getState().hydrateWorkItems([original]);
    useBacklogStore.setState({ projectId: original.project_id, itemIds: [original.id] });

    expect(useBacklogStore.getState().applyStateDelta(original.id, null, 2, "2026-01-02T00:00:00Z")).toBe(true);
    expect(useBacklogStore.getState().itemIds).toEqual([original.id]);
    expect(useIssueStore.getState().getWorkItem(original.id)).toMatchObject({
      state: null,
      state_revision: 2,
    });
  });
});
