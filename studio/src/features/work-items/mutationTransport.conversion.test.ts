import { afterEach, expect, it, vi } from "vitest";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { createWorkItem, updateWorkItem, transitionWorkItem, reparentWorkItem, setWorkItemBlockers, reorderWorkItem, deleteWorkItem } from "./mutationTransport";

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
  sprint_id: null,
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


afterEach(async () => { vi.restoreAllMocks(); await resetStudioApolloClient(); });
it("creates from generated variables, preserving nullable identities and returning a public view", async () => {
  const client = studioApolloClient();
  const mutate = vi.spyOn(client, "mutate").mockResolvedValue({ data: { create_work_item: {
    ...issue, id: "123456781234123412341234567890ab", state_id: null, parent_id: null,
    project: { id: "project-1", slug: "CODING" },
  } } } as never);
  const result = await createWorkItem({
    projectId: "12345678-1234-1234-1234-1234567890ab", name: "Item",
    issueTypeId: "12345678-1234-1234-1234-1234567890cd", stateId: null, parentId: null,
  });
  expect(mutate.mock.calls[0][0].variables).toEqual({
    projectId: "123456781234123412341234567890ab", name: "Item",
    issueTypeId: "123456781234123412341234567890cd", stateId: null, parentId: null,
  });
  expect(result).toMatchObject({ id: "12345678-1234-1234-1234-1234567890ab", state_id: null, parent_id: null, key: "CODING-1" });
});

const publicId = "12345678-1234-1234-1234-1234567890ab";
const compactId = "123456781234123412341234567890ab";
const optimistic = { ...issue, id: "optimistic:42" };

it.each([
  { name: "details", execute: () => updateWorkItem({ id: publicId, issueTypeId: publicId, name: "Keep name" }, { optimistic }), expected: { id: compactId, issueTypeId: compactId, name: "Keep name" }, field: "update_work_item" },
  { name: "transition", execute: () => transitionWorkItem({ id: publicId, targetStateId: publicId }, { optimistic }), expected: { id: compactId, targetStateId: compactId }, field: "update_work_item" },
  { name: "reparent", execute: () => reparentWorkItem({ id: publicId, parentId: null }, { optimistic }), expected: { id: compactId, parentId: null }, field: "update_work_item" },
  { name: "blockers", execute: () => setWorkItemBlockers({ id: publicId, blockedByIds: [publicId, "optimistic:42"] }, { optimistic }), expected: { id: compactId, blockedByIds: [compactId, "optimistic:42"] }, field: "update_work_item" },
  { name: "reorder", execute: () => reorderWorkItem({ id: publicId, beforeId: publicId, afterId: null, initialOrderIds: [publicId, "optimistic:42"] }, { optimistic }), expected: { id: compactId, beforeId: compactId, afterId: null, initialOrderIds: [compactId, "optimistic:42"] }, field: "reorder_work_item" },
])("$name sends generated compact variables and returns converted derived fields", async ({ execute, expected, field }) => {
  const client = studioApolloClient();
  const mutate = vi.spyOn(client, "mutate").mockResolvedValue({ data: { [field]: {
    ...issue, id: compactId, parent_id: null, state_id: null, module_id: null,
    children: { nodes: [{ id: compactId, is_archived: false }] },
    blocked_by_edges: { nodes: [{ id: 1, to_issue_id: compactId }] },
  } } } as never);
  const result = await execute();
  expect(mutate.mock.calls[0][0].variables).toEqual(expected);
  expect(mutate.mock.calls[0][0].optimisticResponse).toEqual({ [field]: optimistic });
  expect(result).toMatchObject({ id: publicId, state_id: null, parent_id: null, has_children: true, sub_issues_count: 1, blocked_by_ids: [publicId] });
});

it("delete passes optimistic IDs unchanged and refreshes only the supplied module", async () => {
  const client = studioApolloClient();
  const mutate = vi.spyOn(client, "mutate").mockResolvedValue({ data: { delete_work_item: true } } as never);
  const query = vi.spyOn(client, "query").mockResolvedValue({ data: {} } as never);
  await deleteWorkItem({ id: "optimistic:42" }, { moduleId: publicId });
  expect(mutate.mock.calls[0][0].variables).toEqual({ id: "optimistic:42" });
  expect(query.mock.calls.map(([options]) => options.variables)).toEqual([{ moduleId: compactId }]);
});
