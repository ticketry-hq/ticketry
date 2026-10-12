import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { Project, ProjectCreate, ProjectPatch } from "../../../shared/api/types";
import { declareMutation, refreshRead } from "../../../shared/apollo/declaredMutation";
import {
  CreateWorkTrackerProjectDocument,
  DeleteWorkTrackerProjectDocument,
  UpdateWorkTrackerProjectDocument,
  WorkTrackerProjectOpenDocument,
  WorkTrackerProjectsDocument,
} from "../generated/projects.documents";

const projectsList = () => refreshRead(WorkTrackerProjectsDocument, {});

/** Create a project: the switcher's projects list gains it. */
export const projectCreationMutation = declareMutation({
  document: CreateWorkTrackerProjectDocument,
  variables: (body: ProjectCreate) => ({
    name: body.name,
    slug: body.slug,
    description: body.description,
  }),
  root: "create_project",
  refresh: () => [projectsList()],
  result: (project) => project as Project,
});

export interface ProjectUpdate {
  id: string;
  patch: ProjectPatch;
}

/** Rename or describe a project: the switcher and the open project show it. */
export const projectUpdateMutation = declareMutation({
  document: UpdateWorkTrackerProjectDocument,
  variables: ({ id, patch }: ProjectUpdate) => ({
    id,
    name: patch.name,
    description: patch.description,
  }),
  root: "update_project",
  refresh: ({ id }) => [
    projectsList(),
    refreshRead(WorkTrackerProjectOpenDocument, { projectId: compactWorktrackerId(id) }),
  ],
  result: (project) => project as Project,
});

/** Delete a project: its identity leaves the cache and the switcher. */
export const projectDeletionMutation = declareMutation({
  document: DeleteWorkTrackerProjectDocument,
  variables: (id: string) => ({ id }),
  root: "delete_project",
  evict: (id) => [{ __typename: "WorktrackerProject", id: compactWorktrackerId(id) }],
  refresh: () => [projectsList()],
  result: () => undefined,
});
