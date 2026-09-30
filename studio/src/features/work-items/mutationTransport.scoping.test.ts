import { afterEach, describe, expect, it, vi } from "vitest";

import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { WorkTrackerModuleOpenDocument } from "./generated/workItems.documents";
import { createWorkItem, reparentWorkItem } from "./mutationTransport";

const issue = {
  id: "item-1",
  name: "Item",
  project_id: "project-1",
  sequence_id: 1,
  state_id: "state-1",
  state_revision: 1,
  description: "",
  workspace_tab_order: [],
  parent_id: "module-a",
  module_id: "module-a",
  is_archived: false,
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
  rank: "a",
  issue_type_id: "type-1",
  project: null,
  state_record: null,
  issue_type_record: null,
  children: { nodes: [] },
  blocked_by_edges: { nodes: [] },
  blocks_edges: { nodes: [] },
};

afterEach(async () => {
  vi.restoreAllMocks();
  await resetStudioApolloClient();
});

describe("work-item module convergence", () => {
  it("refreshes only the module that received a created task", async () => {
    const client = studioApolloClient();
    vi.spyOn(client, "mutate").mockResolvedValue({
      data: { create_work_item: issue },
    } as never);
    const query = vi.spyOn(client, "query").mockResolvedValue({ data: {} } as never);

    await createWorkItem(
      "project-1",
      { name: "Item", issue_type_id: "type-1" },
      { moduleId: "module-a" },
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: "module-a" },
      fetchPolicy: "network-only",
    });
  });

  it("refreshes both sides of a cross-module move once", async () => {
    const client = studioApolloClient();
    vi.spyOn(client, "mutate").mockResolvedValue({
      data: { update_work_item: { ...issue, module_id: "module-b" } },
    } as never);
    const query = vi.spyOn(client, "query").mockResolvedValue({ data: {} } as never);

    await reparentWorkItem("item-1", "module-b", {
      moduleIds: ["module-a", "module-a"],
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.map(([options]) => options.variables)).toEqual([
      { moduleId: "module-a" },
      { moduleId: "module-b" },
    ]);
  });
});
