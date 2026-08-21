import * as api from "../../shared/api/client";
import type { ModuleLink } from "../../shared/api/types";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { isAbsoluteFolderPath } from "./path";

export async function setModuleFolder(
  moduleId: string,
  localPath: string,
): Promise<ModuleLink> {
  if (!isAbsoluteFolderPath(localPath)) {
    throw new Error("Module folders require a complete filesystem path.");
  }

  const validation = await api.validateModuleFolder(localPath);
  if (!validation.valid) {
    throw new Error(validation.reason ?? "The module folder is not usable.");
  }

  const saved = await api.upsertModuleLink(moduleId, localPath);
  queryClient.setQueryData<ModuleLink[]>(queryKeys.moduleLinks.all, (current) => {
    const links = current ?? [];
    const found = links.some((link) => link.module_id === moduleId);
    return found
      ? links.map((link) => (link.module_id === moduleId ? saved : link))
      : [...links, saved];
  });
  return saved;
}
