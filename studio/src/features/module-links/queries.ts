import { useQuery } from "@tanstack/react-query";
import * as api from "../../shared/api/client";
import type { ModuleLink } from "../../shared/api/types";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";

const EMPTY_MODULE_LINKS: ModuleLink[] = [];

const fetchModuleLinks = (): Promise<ModuleLink[]> => api.listModuleLinks();

export function getModuleLinksSnapshot(): ModuleLink[] {
  return (
    queryClient.getQueryData<ModuleLink[]>(queryKeys.moduleLinks.all) ??
    EMPTY_MODULE_LINKS
  );
}

export function moduleLinksHaveLoaded(): boolean {
  return (
    queryClient.getQueryData<ModuleLink[]>(queryKeys.moduleLinks.all) !==
    undefined
  );
}

export function getModuleFolder(moduleId: string): string | undefined {
  return getModuleLinksSnapshot().find((link) => link.module_id === moduleId)
    ?.local_path;
}

export function loadModuleLinks(): Promise<ModuleLink[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.moduleLinks.all,
    queryFn: fetchModuleLinks,
    staleTime: 0,
  });
}

export function useModuleLinks(): ModuleLink[] {
  const { data } = useQuery(
    { queryKey: queryKeys.moduleLinks.all, queryFn: fetchModuleLinks },
    queryClient,
  );
  return data ?? EMPTY_MODULE_LINKS;
}

export function seedModuleLinks(moduleLinks: ModuleLink[]): void {
  queryClient.setQueryData(queryKeys.moduleLinks.all, moduleLinks);
}
