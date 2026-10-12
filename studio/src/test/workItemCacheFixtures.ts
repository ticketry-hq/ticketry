// Work-item rows and cache reads for tests that drive the real Apollo cache.
// Shared declared-mutation tests borrow these generated documents only because
// they are real, typed GraphQL contracts.
import {
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  WorkTrackerModuleOpenDocument,
  WorkTrackerWorkItemDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../features/work-items/generated/workItems.documents";
import { studioApolloClient } from "../shared/apollo/client";

export { WorkTrackerModuleOpenDocument, WorkTrackerWorkItemDocument };

export function issueRow(
  id: string,
  fields: Partial<GeneratedWorkTrackerWorkItemFieldsFragment> = {},
): GeneratedWorkTrackerWorkItemFieldsFragment {
  return {
    __typename: "WorktrackerIssue",
    id,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    state_id: "state-1",
    state_revision: 1,
    description: "",
    workspace_tab_order: [],
    parent_id: "module-1",
    module_id: "module-1",
    sprint_id: null,
    is_archived: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    rank: "a",
    issue_type_id: "type-1",
    project: null,
    state_record: null,
    issue_type_record: null,
    children: { __typename: "WorktrackerIssueConnection", nodes: [] },
    blocked_by_edges: { __typename: "WorktrackerIssueDependencyConnection", nodes: [] },
    blocks_edges: { __typename: "WorktrackerIssueDependencyConnection", nodes: [] },
    ...fields,
  } as GeneratedWorkTrackerWorkItemFieldsFragment;
}

export function moduleOpenData(rows: GeneratedWorkTrackerWorkItemFieldsFragment[]) {
  return {
    module: { __typename: "WorktrackerIssueConnection", nodes: [] },
    work_items: { __typename: "WorktrackerIssueConnection", nodes: rows },
  };
}

export function workItemData(row: GeneratedWorkTrackerWorkItemFieldsFragment) {
  return { work_item: { __typename: "WorktrackerIssueConnection", nodes: [row] } };
}

export function seedModule(moduleId: string, rows: GeneratedWorkTrackerWorkItemFieldsFragment[]) {
  studioApolloClient().writeQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId },
    data: moduleOpenData(rows) as never,
  });
}

export function cachedModuleIds(moduleId: string): string[] | undefined {
  return studioApolloClient().readQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId },
  })?.work_items.nodes.map((row) => row.id);
}

export function cachedIssue(id: string, optimistic = false) {
  const client = studioApolloClient();
  return client.readFragment({
    id: client.cache.identify({ __typename: "WorktrackerIssue", id }),
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    optimistic,
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
