import { useQuery } from "@tanstack/react-query";

import * as api from "../../shared/api/client";
import { getModulesSnapshot } from "../projects/queries";
import type { Module, ModulePresentation } from "../../shared/api/types";
import { queryKeys } from "../../shared/query/keys";
import { queryClient } from "../../shared/query/queryClient";

export function useModulePresentationsQuery() {
  return useQuery(
    {
      queryKey: queryKeys.modulePresentations.all,
      queryFn: ({ signal }) => api.listModulePresentations(signal),
      staleTime: 0,
    },
    queryClient,
  );
}

export function loadModulePresentations(): Promise<ModulePresentation[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.modulePresentations.all,
    queryFn: () => api.listModulePresentations(),
    staleTime: 0,
  });
}

export function hiddenModuleIds(
  presentations: readonly ModulePresentation[] | undefined,
): ReadonlySet<string> {
  if (!presentations) return new Set();
  return new Set(
    presentations
      .filter((presentation) => presentation.tab_hidden)
      .map((presentation) => presentation.module_id),
  );
}

/** Keep presentation state separate from the server-owned canonical order. */
export function visibleModules(
  modules: readonly Module[],
  presentations: readonly ModulePresentation[] | undefined,
): Module[] {
  const hiddenIds = hiddenModuleIds(presentations);
  return modules.filter((module) => !hiddenIds.has(module.id));
}

/** Visible, canonically ordered tabs for imperative keyboard entry points. */
export function getVisibleModulesSnapshot(projectId: string | null): Module[] {
  const presentations = queryClient.getQueryData<ModulePresentation[]>(
    queryKeys.modulePresentations.all,
  );
  return visibleModules(getModulesSnapshot(projectId), presentations);
}
