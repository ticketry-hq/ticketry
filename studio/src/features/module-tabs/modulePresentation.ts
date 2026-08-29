import { skipToken, useQuery } from "@apollo/client/react";

import {
  WorkTrackerProjectOpenDocument,
  getModulesSnapshot,
} from "../projects";
import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../shared/api/generatedWorktracker";
import type { Module, ModulePresentation } from "../../shared/api/types";
import { studioApolloClient } from "../../shared/apollo/client";

function presentationsFromRows(
  rows: ReadonlyArray<{
    readonly module_id: string;
    readonly rank: string;
    readonly tab_hidden: boolean;
  }>,
): ModulePresentation[] {
  return rows.map((presentation) => ({
    module_id: publicWorktrackerId(presentation.module_id),
    rank: presentation.rank,
    tab_hidden: presentation.tab_hidden,
  }));
}

export function useModulePresentations(
  projectId: string | null,
): ModulePresentation[] | undefined {
  const query = useQuery(
    WorkTrackerProjectOpenDocument,
    projectId
      ? {
          client: studioApolloClient(),
          fetchPolicy: "cache-only",
          variables: { projectId: compactWorktrackerId(projectId) },
        }
      : skipToken,
  );
  return query.data
    ? presentationsFromRows(query.data.module_presentations.nodes)
    : undefined;
}

export function getModulePresentationsSnapshot(
  projectId: string | null,
): ModulePresentation[] {
  if (!projectId) return [];
  const data = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    optimistic: true,
  });
  return data
    ? presentationsFromRows(data.module_presentations.nodes)
    : [];
}

export function hiddenModuleIds(
  presentations: readonly ModulePresentation[] | undefined,
): ReadonlySet<string> {
  return new Set(
    (presentations ?? [])
      .filter((presentation) => presentation.tab_hidden)
      .map((presentation) => presentation.module_id),
  );
}

export function visibleModules(
  modules: readonly Module[],
  presentations: readonly ModulePresentation[] | undefined,
): Module[] {
  const hiddenIds = hiddenModuleIds(presentations);
  return modules.filter(
    (module) => !module.is_archived && !hiddenIds.has(module.id),
  );
}

export function getVisibleModulesSnapshot(projectId: string | null): Module[] {
  return visibleModules(
    getModulesSnapshot(projectId),
    getModulePresentationsSnapshot(projectId),
  );
}
