import { studioRuntime } from "../../../runtime";
import type { Module, Project, Workspace } from "../../../shared/api/types";
import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../../shared/api/generatedWorktracker";
import {
  WorkTrackerModulesDocument,
  WorkTrackerProjectsDocument,
  WorkTrackerWorkspaceDocument,
} from "../generated/operations";

export function readProjects(): Promise<Project[]> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => (
      await execute(WorkTrackerProjectsDocument, {})
    ).projects.nodes
      .map((project) => ({ ...project, id: publicWorktrackerId(project.id) }))
      .sort((left, right) =>
        left.created_at.localeCompare(right.created_at)
        || left.id.localeCompare(right.id)
      )
      .map(({ created_at: _createdAt, ...project }) => project),
  });
}

export function readModules(projectId: string): Promise<Module[]> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => {
      const modules = (
        await execute(WorkTrackerModulesDocument, {
          projectId: compactWorktrackerId(projectId),
        })
      ).modules.nodes
        .filter((module) => !module.is_archived)
        .map((module): Module & { rank: string; manual_module_order: boolean } => ({
          id: publicWorktrackerId(module.id),
          name: module.name,
          project_id: publicWorktrackerId(module.project_id),
          sequence_id: module.sequence_id,
          key: `${module.project.slug}-${module.sequence_id}`,
          is_archived: module.is_archived,
          issue_type: publicWorktrackerId(module.issue_type),
          rank: module.rank,
          manual_module_order: module.project.manual_module_order,
        }));
      modules.sort((left, right) => {
        if (left.manual_module_order) {
          return left.rank === right.rank
            ? left.id.localeCompare(right.id)
            : left.rank.localeCompare(right.rank);
        }
        return left.sequence_id === right.sequence_id
          ? left.id.localeCompare(right.id)
          : right.sequence_id - left.sequence_id;
      });
      return modules.map(({ rank: _rank, manual_module_order: _manual, ...module }) => module);
    },
  });
}

export function readWorkspace(): Promise<Workspace> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => {
      const workspace = (await execute(WorkTrackerWorkspaceDocument, {}))
        .workspace.nodes[0];
      if (!workspace) throw new Error("The WorkTracker workspace is unavailable.");
      return { ...workspace, id: publicWorktrackerId(workspace.id) };
    },
  });
}
