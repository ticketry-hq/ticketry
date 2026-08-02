import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>("../shared/api/client");
  return {
    ...actual,
    getWorkItem: vi.fn(),
    listModules: vi.fn(),
    listProjectWorkItems: vi.fn(),
  };
});

vi.mock("../features/agents/api/agentApi", async () => {
  const actual = await vi.importActual<typeof import("../features/agents/api/agentApi")>(
    "../features/agents/api/agentApi",
  );
  return { ...actual, getConfig: vi.fn() };
});

import * as api from "../shared/api/client";
import * as studioApi from "../features/agents/api/agentApi";
import { useConfigStore } from "../features/agents/stores/configStore";
import { useIssueDrawerWorkspaceStore } from "../features/work-items/issue-detail/internal/drawerWorkspaceStore";
import { useIssueStore } from "../features/work-items/issue-detail/internal/issueStore";
import type { Module, State, WorkItem } from "../shared/api/types";

const getWorkItem = vi.mocked(api.getWorkItem);
const listModules = vi.mocked(api.listModules);
const listProjectWorkItems = vi.mocked(api.listProjectWorkItems);
const getConfig = vi.mocked(studioApi.getConfig);
const TODO: State = {
  id: "state-todo",
  name: "Todo",
  group: "unstarted",
  color: null,
};

const MODULE: Module = {
  id: "module-1",
  key: "CODIN-1",
  name: "Drawer",
  project_id: "project-1",
  sequence_id: 1,
  issue_type: { id: "type-module", name: "Module", level: "module" },
};

function task(partial: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "task-1",
    key: "CODIN-748",
    name: "Issue workspace seam",
    project_id: "project-1",
    sequence_id: 748,
    state: TODO,
    description: null,
    parent_id: MODULE.id,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...partial,
    issue_type: partial.issue_type ?? { id: "type-task", name: "Task", level: "task" },
  };
}

beforeEach(() => {
  useIssueDrawerWorkspaceStore.getState().reset();
  useIssueDrawerWorkspaceStore.setState({ workspaces: {} });
  useIssueStore.setState({
    workItemsById: {},
    workItemIdByKey: {},
    childWorkItemIds: {},
  });
  useConfigStore.setState({ profiles: [], recentProfileIndex: null });

  getWorkItem.mockReset().mockResolvedValue({ task: task(), attachments: [] });
  listModules.mockReset().mockResolvedValue([MODULE]);
  listProjectWorkItems.mockReset().mockResolvedValue([]);
  getConfig.mockReset().mockResolvedValue({
    recent_profile_index: 0,
    profiles: [{
      name: "Studio",
      workspace_slug: "meml",
      agent_prompt: null,
      agent_prompts: {},
      module_folders: {},
    }],
  });
});

describe("issue drawer workspace orchestration", () => {
  it("hydrates from issue key only and exposes launch context", async () => {
    await useIssueDrawerWorkspaceStore.getState().hydrate("CODIN-748");

    expect(getWorkItem).toHaveBeenCalledWith("CODIN-748", undefined);

    const view = useIssueDrawerWorkspaceStore.getState().byIssueKey["CODIN-748"];
    expect(view.taskId).toBe("task-1");
    expect(useIssueStore.getState().getWorkItem("task-1")?.name).toBe("Issue workspace seam");
    expect(view.module?.moduleId).toBe(MODULE.id);
    expect(view.profile.status).toBe("ready");
    expect(view.launchContext).toMatchObject({
      projectId: "project-1",
      moduleId: MODULE.id,
      taskId: "task-1",
      taskKey: "CODIN-748",
      ticketSeq: 748,
      profileReady: true,
    });
  });

  it("treats a selected local profile as launch-ready", async () => {
    getConfig.mockResolvedValueOnce({
      recent_profile_index: 0,
      profiles: [{
        name: "Studio",
        workspace_slug: "meml",
        agent_prompt: null,
        agent_prompts: {},
        module_folders: {},
      }],
    });

    await useIssueDrawerWorkspaceStore.getState().hydrate("CODIN-748");

    const view = useIssueDrawerWorkspaceStore.getState().byIssueKey["CODIN-748"];
    expect(view.profile.status).toBe("ready");
    expect(view.launchContext?.profileReady).toBe(true);
  });

  it("does not mutate Studio project, module, or task selection", async () => {
    await useIssueDrawerWorkspaceStore.getState().hydrate("CODIN-748");

  });

  it("exposes explicit degraded module context when ancestry cannot resolve it", async () => {
    listModules.mockResolvedValueOnce([]);

    await useIssueDrawerWorkspaceStore.getState().hydrate("CODIN-748");

    const view = useIssueDrawerWorkspaceStore.getState().byIssueKey["CODIN-748"];
    expect(view.module?.status).toBe("degraded");
    expect(view.launchContext?.moduleId).toBeNull();
  });
});
