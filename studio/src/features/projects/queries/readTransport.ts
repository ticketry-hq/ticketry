import { studioRuntime } from "../../../runtime";
import * as rest from "../../../shared/api/client";
import type { Module, Project, Workspace } from "../../../shared/api/types";
import {
  WorkTrackerModulesDocument,
  WorkTrackerProjectsDocument,
  WorkTrackerWorkspaceDocument,
} from "../generated/operations";

export function readProjects(): Promise<Project[]> {
  return studioRuntime().readWorkTracker({
    rest: rest.listProjects,
    graphQl: async (execute) => [
      ...(await execute(WorkTrackerProjectsDocument, {})).projects,
    ],
  });
}

export function readModules(projectId: string): Promise<Module[]> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.listModules(projectId),
    graphQl: async (execute) => [
      ...(await execute(WorkTrackerModulesDocument, {
        projectId,
        includeArchived: false,
      })).modules,
    ],
  });
}

export function readWorkspace(): Promise<Workspace> {
  return studioRuntime().readWorkTracker({
    rest: rest.getWorkspace,
    graphQl: async (execute) => {
      const workspace = (await execute(WorkTrackerWorkspaceDocument, {}))
        .workspace;
      if (!workspace) throw new Error("The WorkTracker workspace is unavailable.");
      return workspace;
    },
  });
}
