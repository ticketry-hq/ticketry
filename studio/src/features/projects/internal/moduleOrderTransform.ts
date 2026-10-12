import type { ApolloCache } from "@apollo/client";

import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { WorkTrackerProjectOpenDocument } from "../generated/projects.documents";

/** The presentation rank Studio shows for a Module at this planned position. */
export function plannedModuleRank(index: number): string {
  return String(index).padStart(8, "0");
}

/**
 * Show `order` as the project's Module order in its open query.
 *
 * Every reorder-visible surface reads this one cached order, so writing it
 * here moves the sidebar, the tab strip and read-only consumers together.
 * Ranks are planned positions; the post-write project read replaces them with
 * the server's.
 */
export function applyModuleOrder(
  cache: ApolloCache,
  projectId: string,
  order: readonly string[],
): void {
  const variables = { projectId: compactWorktrackerId(projectId) };
  cache.updateQuery({ query: WorkTrackerProjectOpenDocument, variables }, (current) => {
    if (!current) return current;
    const positions = new Map(order.map((id, index) => [compactWorktrackerId(id), index]));
    const existing = new Map(
      current.module_presentations.nodes.map((presentation) => [
        presentation.module_id,
        presentation,
      ]),
    );
    const orderedPresentations = order.map((id, index) => {
      const moduleId = compactWorktrackerId(id);
      const presentation = existing.get(moduleId);
      return {
        __typename: "WorktrackerModulepresentation" as const,
        module_id: moduleId,
        rank: plannedModuleRank(index),
        tab_hidden: presentation?.tab_hidden ?? false,
        module: presentation?.module ?? {
          __typename: "WorktrackerIssue" as const,
          id: moduleId,
          project_id: variables.projectId,
        },
      };
    });
    const orderedIds = new Set(orderedPresentations.map((row) => row.module_id));
    return {
      ...current,
      modules: {
        ...current.modules,
        nodes: [...current.modules.nodes].sort((left, right) =>
          (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER)
          - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        ),
      },
      module_presentations: {
        ...current.module_presentations,
        nodes: [
          ...current.module_presentations.nodes.filter(
            (presentation) => !orderedIds.has(presentation.module_id),
          ),
          ...orderedPresentations,
        ],
      },
    };
  });
}
