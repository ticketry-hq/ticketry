import * as api from "../../../../shared/api/client";
import type { Module, WorkItem, WorkItemDetail } from "../../../../shared/api/types";

export interface IssueWorkspaceModuleContext {
  moduleId: string | null;
  module: Module | null;
  status: "ready" | "degraded";
  reason: string | null;
}

export interface IssueWorkspaceContext {
  detail: WorkItemDetail;
  task: WorkItem;
  projectId: string;
  module: IssueWorkspaceModuleContext;
}

function findModuleAncestor(
  task: WorkItem,
  modules: Module[],
  projectItems: WorkItem[],
): Module | null {
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const itemById = new Map(projectItems.map((item) => [item.id, item]));
  let parentId = task.parent_id;
  const seen = new Set<string>();

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const module = moduleById.get(parentId);
    if (module) return module;
    parentId = itemById.get(parentId)?.parent_id ?? null;
  }

  return null;
}

export async function resolveIssueWorkspaceContext(
  keyOrId: string,
  signal?: AbortSignal,
): Promise<IssueWorkspaceContext> {
  const detail = await api.getWorkItem(keyOrId, signal);
  const task = detail.task;
  const projectId = task.project_id;

  const [modulesResult, itemsResult] = await Promise.allSettled([
    api.listModules(projectId),
    api.listProjectWorkItems(projectId),
  ]);

  const modules = modulesResult.status === "fulfilled" ? modulesResult.value : [];
  const projectItems = itemsResult.status === "fulfilled" ? itemsResult.value : [];
  const module = findModuleAncestor(task, modules, projectItems);

  return {
    detail,
    task,
    projectId,
    module: module
      ? { moduleId: module.id, module, status: "ready", reason: null }
      : {
          moduleId: null,
          module: null,
          status: "degraded",
          reason: "Module context could not be resolved from issue ancestry.",
        },
  };
}
