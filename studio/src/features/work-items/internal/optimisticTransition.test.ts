import { InMemoryCache } from "@apollo/client";
import { describe, expect, it } from "vitest";

import type { State } from "../../../shared/api/types";
import {
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  WorkTrackerModuleOpenDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../generated/workItems.documents";
import { optimisticTransitionedIssue } from "./optimisticTransition";

const moduleId = "module-1";

function issue(
  id: string,
  stateId: string,
  rank: string,
): GeneratedWorkTrackerWorkItemFieldsFragment {
  return {
    __typename: "WorktrackerIssue",
    id,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    state_id: stateId,
    description: "",
    workspace_tab_order: [],
    parent_id: moduleId,
    module_id: moduleId,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    rank,
    issue_type_id: "story-type",
    project: null,
    state_record: null,
    issue_type_record: null,
    children: { nodes: [] },
    blocked_by_edges: { nodes: [] },
    blocks_edges: { nodes: [] },
  } as GeneratedWorkTrackerWorkItemFieldsFragment;
}

function destinationState(): State & { id: string } {
  return {
    id: "ready",
    name: "Ready",
    group: "unstarted",
    color: "#999999",
    sort_order: 1,
    is_protected: false,
  };
}

function cacheWithItems(nodes: GeneratedWorkTrackerWorkItemFieldsFragment[]): InMemoryCache {
  const cache = new InMemoryCache();
  cache.writeQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId },
    data: {
      module: { __typename: "WorktrackerIssueConnection", nodes: [] },
      work_items: { __typename: "WorktrackerIssueConnection", nodes },
    } as never,
  });
  for (const item of nodes) {
    cache.writeFragment({
      fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
      data: item,
    });
  }
  return cache;
}

describe("optimistic workflow transition", () => {
  it("moves state and rank together before the first destination item while excluding itself", () => {
    const moving = issue("moving", "ready", "A");
    const cache = cacheWithItems([
      moving,
      issue("destination-first", "ready", "V"),
      issue("destination-later", "ready", "kV"),
    ]);

    const transitioned = optimisticTransitionedIssue(
      cache,
      moving,
      destinationState(),
    );

    expect({ state: transitioned.state_id, rank: transitioned.rank }).toEqual({
      state: "ready",
      rank: "FV",
    });
  });

  it("assigns a fresh non-empty rank when the destination is empty", () => {
    const moving = issue("moving", "doing", "kV");
    const cache = cacheWithItems([
      moving,
      issue("source-peer", "doing", "V"),
    ]);

    const transitioned = optimisticTransitionedIssue(
      cache,
      moving,
      destinationState(),
    );

    expect(transitioned.rank).toBe("V");
    expect(transitioned.rank).not.toBe(moving.rank);
  });
});
