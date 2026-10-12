import { skipToken, useQuery } from "@apollo/client/react";

import { publicResult, serverVariables } from "../../shared/api/worktrackerConversion";
import type { ModulePresentation } from "./modulePresentationTypes";
import type { Module } from "./types";
import { studioApolloClient } from "../../shared/apollo/client";
import { WorkTrackerProjectOpenDocument } from "./generated/projects.documents";
import { getModulesSnapshot } from "./queries";

export function useModulePresentations(
  projectId: string | null,
): ModulePresentation[] | undefined {
  const query = useQuery(
    WorkTrackerProjectOpenDocument,
    projectId
      ? {
          client: studioApolloClient(),
          fetchPolicy: "cache-only",
          variables: serverVariables(WorkTrackerProjectOpenDocument, { projectId }),
        }
      : skipToken,
  );
  return query.data
    ? publicResult(WorkTrackerProjectOpenDocument, query.data).module_presentations.nodes
    : undefined;
}

export function getModulePresentationsSnapshot(
  projectId: string | null,
): ModulePresentation[] {
  if (!projectId) return [];
  const data = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: serverVariables(WorkTrackerProjectOpenDocument, { projectId }),
    optimistic: true,
  });
  return data
    ? publicResult(WorkTrackerProjectOpenDocument, data).module_presentations.nodes
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
