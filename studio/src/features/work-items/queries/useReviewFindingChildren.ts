import { skipToken, useQuery } from "@apollo/client/react";
import { useMemo } from "react";
import type { WorkItem } from "../../../shared/api/types";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import { WorkTrackerReviewFindingsDocument } from "../generated/workItems.documents";
import { orderedWorkItems } from "../issueAdapter";

const NO_CHILDREN: WorkItem[] = [];

/**
 * A Story's direct task children, archived ones included. Module membership
 * drops archived rows, but a cancelled review finding is archived and must stay
 * listed in the parent's Review panel as resolved.
 */
export function useReviewFindingChildren(parentId: string | null): WorkItem[] {
  const { data } = useQuery(
    WorkTrackerReviewFindingsDocument,
    parentId
      ? {
          variables: { parentId: compactWorktrackerId(parentId) },
          client: studioApolloClient(),
          fetchPolicy: "cache-and-network",
          nextFetchPolicy: "cache-first",
        }
      : skipToken,
  );
  return useMemo(
    () => data ? orderedWorkItems(data.findings.nodes) : NO_CHILDREN,
    [data],
  );
}
