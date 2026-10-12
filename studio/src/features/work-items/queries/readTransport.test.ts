import type { WorkItem } from "../workItemView";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";

import { resetStudioApolloClient, studioApolloClient } from "../../../shared/apollo/client";
import type { GeneratedWorkTrackerWorkItemFieldsFragment as Row } from "../generated/workItems.documents";
import { readModuleTreeRecords, readProjectWorkItems, readWorkItem } from "./readTransport";
import { getWorkItemSnapshot } from "./index";

const row: Row = {
  id: "11111111111111111111111111111111", name: "Story", description: "", rank: "V",
  project_id: "22222222222222222222222222222222", sequence_id: 7,
  state_id: "33333333333333333333333333333333", state_revision: 9,
  workspace_tab_order: ["notes"], parent_id: "44444444444444444444444444444444",
  module_id: "55555555555555555555555555555555", sprint_id: null,
  issue_type_id: "66666666666666666666666666666666", is_archived: false,
  created_at: "2026-10-11T00:00:00", updated_at: "2026-10-11T01:00:00+05:30",
  project: { id: "22222222222222222222222222222222", slug: "APP" },
  state_record: null, issue_type_record: null,
  children: { nodes: [{ id: "child-active", is_archived: false }, { id: "child-archived", is_archived: true }] },
  blocked_by_edges: { nodes: [{ id: 1, to_issue_id: "77777777777777777777777777777777" }] },
  blocks_edges: { nodes: [{ id: 2, from_issue_id: "88888888888888888888888888888888" }] },
};

afterEach(async () => { vi.restoreAllMocks(); await resetStudioApolloClient(); });

it("exposes selected module and sprint fields with generated nullability", () => {
  expectTypeOf<WorkItem["module_id"]>().toEqualTypeOf<Row["module_id"]>();
  expectTypeOf<WorkItem["sprint_id"]>().toEqualTypeOf<Row["sprint_id"]>();
  expectTypeOf<WorkItem["module_id"]>().toEqualTypeOf<string | null>();
  expectTypeOf<WorkItem["sprint_id"]>().toEqualTypeOf<string | null>();
});

it("returns every selected field and derived values from compact work-item rows", async () => {
  vi.spyOn(studioApolloClient(), "query").mockResolvedValue({ data: { work_item: { nodes: [row] } } } as never);
  const item = await readWorkItem("APP-7");
  expect(item).toMatchObject({
    id: "11111111-1111-1111-1111-111111111111", project_id: "22222222-2222-2222-2222-222222222222",
    state_id: "33333333-3333-3333-3333-333333333333", parent_id: "44444444-4444-4444-4444-444444444444",
    module_id: "55555555-5555-5555-5555-555555555555", sprint_id: null,
    issue_type_id: "66666666-6666-6666-6666-666666666666", state_revision: 9, workspace_tab_order: ["notes"],
    created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T01:00:00+05:30",
    key: "APP-7", sub_issues_count: 1, has_children: true,
    blocked_by_ids: ["77777777-7777-7777-7777-777777777777"], blocks_ids: ["88888888-8888-8888-8888-888888888888"],
  });
  expect(row.id).toBe("11111111111111111111111111111111");
});

it("keeps archived-only children visible as a hierarchy with zero active children", async () => {
  const archivedOnly = { ...row, state_id: null, parent_id: null,
    children: { nodes: [{ id: "archived", is_archived: true }] } };
  vi.spyOn(studioApolloClient(), "query").mockResolvedValue({ data: { work_item: { nodes: [archivedOnly] } } } as never);
  expect(await readWorkItem(row.id)).toMatchObject({ state_id: null, parent_id: null,
    has_children: true, sub_issues_count: 0 });
});

it("converts cached fragments without changing compact cache rows", () => {
  vi.spyOn(studioApolloClient(), "readFragment").mockReturnValue(row);
  expect(getWorkItemSnapshot(row.id)).toMatchObject({
    id: "11111111-1111-1111-1111-111111111111",
    module_id: "55555555-5555-5555-5555-555555555555", key: "APP-7",
    blocked_by_ids: ["77777777-7777-7777-7777-777777777777"],
  });
  expect(row.created_at).toBe("2026-10-11T00:00:00");
});

it("returns ordered converted project rows and accepts compact module identities", async () => {
  const client = studioApolloClient();
  const query = vi.spyOn(client, "query").mockResolvedValue({ data: { work_items: { nodes: [
    { ...row, rank: "a" }, { ...row, id: "second", rank: "V" },
  ] } } } as never);
  expect((await readProjectWorkItems(row.project_id)).map(item => item.id)).toEqual([
    "second", "11111111-1111-1111-1111-111111111111",
  ]);
  query.mockResolvedValue({ data: { work_items: { nodes: [row] } } } as never);
  const tree = await readModuleTreeRecords(row.project_id, row.parent_id!);
  expect(tree.rootIds).toEqual(["11111111-1111-1111-1111-111111111111"]);
  expect(tree.workItems[0].state_id).toBe("33333333-3333-3333-3333-333333333333");
});
