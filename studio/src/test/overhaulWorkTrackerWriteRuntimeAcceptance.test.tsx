import { describe, expect, it, vi } from "vitest";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";
import { createProject } from "../features/projects/mutationTransport";
import {
  createWorkItem, deleteWorkItem, reparentWorkItem, reorderWorkItem,
  setWorkItemBlockers, transitionWorkItem, updateWorkItem,
} from "../features/work-items/mutationTransport";
import {
  createIssueType, createState, reorderIssueTypes, reorderStates,
  setIssueTypeWorkflowStartState, updateIssueType, updateState,
} from "../features/workflows/mutationTransport";

const startup = {
  serviceHealth: { state: "ready", service: "backend", message: null, logPointer: null },
  initialNotices: [],
};

const issue = {
  id: "item-1", name: "Item", project_id: "project-1", sequence_id: 1,
  state_id: "state-1", state_revision: 1, description: "", parent_id: null,
  module_id: null, is_archived: false,
  created_at: "2026-08-12T00:00:00Z", updated_at: "2026-08-12T00:00:00Z",
  rank: "a", issue_type_id: "type-1", project: { slug: "PRJ" },
  children: { nodes: [] }, blocked_by_edges: { nodes: [] }, blocks_edges: { nodes: [] },
};
const state = { id: "state-1", project: "project-1", name: "Todo", group: "unstarted", color: "#fff", sort_order: 0, is_protected: false, created_at: "", updated_at: "" };
const issueType = { id: "type-1", project: "project-1", name: "Story", level: "task", color: "", sort_order: 0, start_state: "state-1", workflow_revision: 1, is_pathfind: false, created_at: "", updated_at: "" };

describe("WorkTracker write runtime acceptance", () => {
  it("[overhaul-74] sends user-visible WorkTracker mutations through the desktop GraphQL contract", async () => {
    const operations: string[] = [];
    const graphqlExecute = vi.fn(async (encoded: string) => {
      const { operationName, query } = JSON.parse(encoded) as { operationName: string; query: string };
      operations.push(operationName);
      if (operationName === "CreateWorkTrackerIssueType") {
        expect(query).toContain("worktrackerIssuetypeCreateOne");
        expect(query).not.toContain("create_issue_type(project_id:");
      }
      const field = ({
        CreateWorkTrackerProject: ["create_project", { id: "project-1", name: "Project", slug: "PRJ", description: "", manual_module_order: false }],
        CreateWorkTrackerWorkItem: ["create_work_item", issue], UpdateWorkTrackerWorkItem: ["update_work_item", issue],
        TransitionWorkTrackerWorkItem: ["update_work_item", issue], ReparentWorkTrackerWorkItem: ["update_work_item", issue],
        SetWorkTrackerBlockers: ["update_work_item", issue], ReorderWorkTrackerWorkItem: ["reorder_work_item", issue],
        DeleteWorkTrackerWorkItem: ["delete_work_item", true], CreateWorkTrackerState: ["create_state", state],
        UpdateWorkTrackerState: ["update_state", state], ReorderWorkTrackerStates: ["reorder_states", [state]],
        CreateWorkTrackerIssueType: ["create_issue_type", issueType], UpdateWorkTrackerIssueType: ["update_issue_type", issueType],
        ReorderWorkTrackerIssueTypes: ["reorder_issue_types", [issueType]], SetWorkTrackerStartState: ["update_issue_type", { id: "type-1", workflow_revision: 2 }],
      } as Record<string, [string, unknown]>)[operationName];
      if (!field) throw new Error(`Unexpected operation ${operationName}`);
      return JSON.stringify({ data: { [field[0]]: field[1] } });
    });
    initializeStudioRuntime(await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({ graphql_execute: graphqlExecute, graphql_subscribe: vi.fn(), graphql_unsubscribe: vi.fn() }),
    }));

    await createProject({ name: "Project", slug: "PRJ", description: "" });
    await createWorkItem("project-1", { name: "Item", issue_type_id: "type-1" });
    await updateWorkItem("item-1", { name: "Renamed" });
    await transitionWorkItem("item-1", "state-1");
    await reparentWorkItem("item-1", null);
    await setWorkItemBlockers("item-1", []);
    await reorderWorkItem("item-1", { before_id: null, after_id: null });
    await deleteWorkItem("item-1");
    await createState("project-1", { name: "Todo", group: "unstarted" });
    await updateState("state-1", { name: "Ready" });
    await reorderStates("project-1", ["state-1"]);
    await createIssueType("project-1", { name: "Story", level: "task" });
    await updateIssueType("type-1", { color: "#fff" });
    await reorderIssueTypes("project-1", ["type-1"]);
    await setIssueTypeWorkflowStartState("type-1", "state-1", 1);

    expect(operations).toEqual([
      "CreateWorkTrackerProject", "CreateWorkTrackerWorkItem", "UpdateWorkTrackerWorkItem",
      "TransitionWorkTrackerWorkItem", "ReparentWorkTrackerWorkItem", "SetWorkTrackerBlockers",
      "ReorderWorkTrackerWorkItem", "DeleteWorkTrackerWorkItem", "CreateWorkTrackerState",
      "UpdateWorkTrackerState", "ReorderWorkTrackerStates", "CreateWorkTrackerIssueType",
      "UpdateWorkTrackerIssueType", "ReorderWorkTrackerIssueTypes", "SetWorkTrackerStartState",
    ]);
  });
});
