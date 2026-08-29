import { useFragment } from "@apollo/client/react";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  WorkTrackerWorkItemDocument,
} from "../work-items/generated/workItems.documents";
import {
  workspaceTabOrderFromJson,
  type WorkspaceTabOrder,
} from "./types";

const EMPTY_ORDER: WorkspaceTabOrder = { order: [] };

const issueReference = (id: string) => ({
  __typename: "WorktrackerIssue" as const,
  id: compactWorktrackerId(id),
});

export interface WorkspaceTabOrderQuery extends WorkspaceTabOrder {
  readonly isReady: boolean;
}

export function useWorkspaceTabOrder(
  workItemId: string | null,
): WorkspaceTabOrderQuery {
  const fragment = useFragment({
    client: studioApolloClient(),
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    from: workItemId ? issueReference(workItemId) : null,
  });
  if (!workItemId || !fragment.complete || !("workspace_tab_order" in fragment.data)) {
    return { ...EMPTY_ORDER, isReady: false };
  }
  return {
    ...workspaceTabOrderFromJson(fragment.data.workspace_tab_order),
    isReady: true,
  };
}

export async function loadWorkspaceTabOrder(
  workItemId: string,
): Promise<WorkspaceTabOrder> {
  const client = studioApolloClient();
  const cached = client.readFragment({
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    from: issueReference(workItemId),
    optimistic: true,
  });
  if (cached && "workspace_tab_order" in cached) {
    return workspaceTabOrderFromJson(cached.workspace_tab_order);
  }
  const result = await client.query({
    query: WorkTrackerWorkItemDocument,
    variables: { id: compactWorktrackerId(workItemId) },
    fetchPolicy: "cache-first",
  });
  const row = result.data?.work_item.nodes[0];
  if (!row) throw new Error(`Work item ${workItemId} was not found.`);
  return workspaceTabOrderFromJson(row.workspace_tab_order);
}
