import { describe, expect, it } from "vitest";

import { orderedWorkItems } from "./issueAdapter";
import type { GeneratedWorkTrackerWorkItemFieldsFragment } from "./generated/workItems.documents";

// Exactly what the Rust `fractional_rank::rebalance(5)` allocates. Every case
// is mixed, so locale collation and byte order disagree on all of them.
const SERVER_RANKS = [
  "AKfKfKfKfKfKfKfKfKfK",
  "KfKfKfKfKfKfKfKfKfKf",
  "V",
  "fKfKfKfKfKfKfKfKfKfK",
  "pfKfKfKfKfKfKfKfKfKf",
];

function issue(
  rank: string,
  sequenceId: number,
): GeneratedWorkTrackerWorkItemFieldsFragment {
  return {
    id: `0000000000000000000000000000000${sequenceId}`,
    name: `Story ${sequenceId}`,
    project_id: "project",
    sequence_id: sequenceId,
    state_id: "state",
    description: "",
    workspace_tab_order: [],
    parent_id: "module",
    module_id: "module",
    is_archived: false,
    created_at: "2026-08-31T00:00:00",
    updated_at: "2026-08-31T00:00:00",
    rank,
    issue_type_id: "type",
    project: null,
    state_record: null,
    issue_type_record: null,
    children: { nodes: [] },
    blocked_by_edges: { nodes: [] },
    blocks_edges: { nodes: [] },
  } as unknown as GeneratedWorkTrackerWorkItemFieldsFragment;
}

describe("orderedWorkItems", () => {
  it("orders mixed-case rank keys the way the server does", () => {
    const rows = SERVER_RANKS.map(issue);
    const shuffled = [rows[3], rows[0], rows[4], rows[2], rows[1]];

    expect(orderedWorkItems(shuffled).map((item) => item.rank)).toEqual(
      SERVER_RANKS,
    );
  });

  it("breaks equal ranks by sequence id", () => {
    const rows = [issue("V", 3), issue("V", 1), issue("V", 2)];

    expect(orderedWorkItems(rows).map((item) => item.sequence_id)).toEqual([
      1, 2, 3,
    ]);
  });
});
