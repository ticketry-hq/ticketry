import type { ApolloCache } from "@apollo/client";

import type { State } from "../../../shared/api/types";
import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../../shared/api/generatedWorktracker";
import {
  WorkTrackerModuleOpenDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../generated/workItems.documents";
import { arrivalRank } from "../utilities/arrivalRank";

export function optimisticTransitionedIssue(
  cache: ApolloCache,
  current: GeneratedWorkTrackerWorkItemFieldsFragment,
  state: State & { id: string },
): GeneratedWorkTrackerWorkItemFieldsFragment {
  const module = current.module_id
    ? cache.readQuery({
        query: WorkTrackerModuleOpenDocument,
        variables: { moduleId: compactWorktrackerId(current.module_id) },
        optimistic: true,
        returnPartialData: true,
      })
    : undefined;
  const movingId = compactWorktrackerId(current.id);
  const candidates = module?.work_items?.nodes.filter(
    (item) => compactWorktrackerId(item.id) !== movingId,
  ) ?? [];

  return {
    ...current,
    state_id: publicWorktrackerId(state.id),
    rank: arrivalRank(candidates, state.id),
    state_record: {
      id: publicWorktrackerId(state.id),
      name: state.name,
      group: state.group,
      color: state.color ?? "",
      sort_order: state.sort_order ?? 0,
      is_protected: state.is_protected ?? false,
    },
  };
}
