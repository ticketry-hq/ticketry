import { InMemoryCache } from "@apollo/client";
import { describe, expect, it } from "vitest";

import {
  WorkTrackerProjectOpenDocument,
} from "../../projects/generated/projects.documents";
import { WorkTrackerModuleOpenDocument } from "../generated/workItems.documents";
import { optimisticCreatedIssue } from "./optimisticCreation";

const membership = { projectId: "project-1", moduleId: "module-1" };

function writeProjectCatalog(cache: InMemoryCache): void {
  const data = {
    project: { __typename: "WorktrackerProjectConnection", nodes: [] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
    module_presentations: { __typename: "WorktrackerModulepresentationConnection", nodes: [] },
    states: {
      __typename: "WorktrackerStateConnection",
      nodes: [
        {
          __typename: "WorktrackerState",
          id: "backlog-state",
          project: membership.projectId,
          name: "Backlog",
          group: "backlog",
          color: "#888888",
          sort_order: 0,
          is_protected: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          __typename: "WorktrackerState",
          id: "start-state",
          project: membership.projectId,
          name: "Ready",
          group: "unstarted",
          color: "#999999",
          sort_order: 1,
          is_protected: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    issue_types: {
      __typename: "WorktrackerIssuetypeConnection",
      nodes: [{
        __typename: "WorktrackerIssuetype",
        id: "story-type",
        project: membership.projectId,
        name: "Story",
        level: "task",
        color: "#ffffff",
        sort_order: 0,
        start_state: "start-state",
        workflow_revision: 1,
        is_pathfind: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        transitions: { __typename: "WorktrackerIssuetypeTransitionConnection", nodes: [] },
        launch_bindings: { __typename: "WorktrackerLaunchbindingConnection", nodes: [] },
      }],
    },
    provider_catalog: {
      __typename: "ProviderCatalog",
      configurable_providers: [],
      providers: [],
      agent_models: [],
      reasoning_levels: [],
      global_default: null,
    },
  };
  cache.writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: membership.projectId },
    data: data as never,
  });
}

function issue(id: string, rank: string, stateId: string, isArchived = false) {
  return {
    __typename: "WorktrackerIssue",
    id,
    name: id,
    project_id: membership.projectId,
    sequence_id: 1,
    state_id: stateId,
    description: "",
    workspace_tab_order: [],
    parent_id: membership.moduleId,
    module_id: membership.moduleId,
    is_archived: isArchived,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    rank,
    issue_type_id: "story-type",
    project: null,
    state_record: null,
    issue_type_record: null,
    children: { __typename: "WorktrackerIssueConnection", nodes: [] },
    blocked_by_edges: { __typename: "WorktrackerIssueBlockerConnection", nodes: [] },
    blocks_edges: { __typename: "WorktrackerIssueBlockerConnection", nodes: [] },
  };
}

function writeModuleItems(
  cache: InMemoryCache,
  nodes: ReturnType<typeof issue>[],
): void {
  const data = {
    module: { __typename: "WorktrackerIssueConnection", nodes: [] },
    work_items: {
      __typename: "WorktrackerIssueConnection",
      nodes,
    },
  };
  cache.writeQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId: membership.moduleId },
    data: data as never,
  });
}

describe("optimistic work-item creation", () => {
  it("uses the cached issue-type start state and inserts before its first active item", () => {
    const cache = new InMemoryCache();
    writeProjectCatalog(cache);
    writeModuleItems(cache, [
      issue("archived-first", "A", "start-state", true),
      issue("current-first", "V", "start-state"),
      issue("later", "kV", "start-state"),
    ]);

    const created = optimisticCreatedIssue(cache, membership, {
      name: "New story",
      issue_type_id: "story-type",
    });

    expect(created.state_id).toBe("start-state");
    expect(created.rank).toBe("FV");
  });

  it("gives an explicitly selected empty state a non-empty initial rank", () => {
    const cache = new InMemoryCache();
    writeProjectCatalog(cache);
    writeModuleItems(cache, [issue("other-state-item", "V", "start-state")]);

    const created = optimisticCreatedIssue(cache, membership, {
      name: "New backlog item",
      issue_type_id: "story-type",
      state_id: "backlog-state",
    });

    expect(created.state_id).toBe("backlog-state");
    expect(created.rank).toBe("V");
  });

  it("falls back to the cached backlog state when the type has no start state", () => {
    const cache = new InMemoryCache();
    writeProjectCatalog(cache);
    writeModuleItems(cache, [issue("backlog-first", "V", "backlog-state")]);

    const created = optimisticCreatedIssue(cache, membership, {
      name: "New task",
      issue_type_id: "unconfigured-type",
    });

    expect(created.state_id).toBe("backlog-state");
    expect(created.rank).toBe("FV");
  });
});
