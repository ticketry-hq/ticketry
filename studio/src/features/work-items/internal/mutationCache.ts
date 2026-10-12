import { studioApolloClient } from "../../../shared/apollo/client";
import { serverVariables } from "../../../shared/api/worktrackerConversion";
import { GeneratedWorkTrackerWorkItemFieldsFragmentDoc, WorkTrackerModuleOpenDocument, DeleteWorkTrackerWorkItemDocument, type GeneratedWorkTrackerWorkItemFieldsFragment } from "../generated/workItems.documents";
import type { ModuleMembership } from "../mutations";

export function cachedIssue(id: string): GeneratedWorkTrackerWorkItemFieldsFragment | undefined {
  const client = studioApolloClient();
  const cacheId = client.cache.identify({
    __typename: "WorktrackerIssue",
    id: serverVariables(DeleteWorkTrackerWorkItemDocument, { id }).id,
  });
  if (!cacheId) return undefined;
  return client.readFragment({
    id: cacheId,
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    optimistic: true,
  }) ?? undefined;
}

export function cachedModuleIssue(
  membership: ModuleMembership,
  id: string,
): GeneratedWorkTrackerWorkItemFieldsFragment | undefined {
  return studioApolloClient().readQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: serverVariables(WorkTrackerModuleOpenDocument, { moduleId: membership.moduleId }),
    optimistic: true,
    returnPartialData: true,
  })?.work_items?.nodes.find(
    (candidate) => candidate.id === serverVariables(DeleteWorkTrackerWorkItemDocument, { id }).id || candidate.id === id,
  );
}

