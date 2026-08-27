import { studioRuntime } from "../../runtime";
import { graphQlMutationError } from "../../shared/api/graphqlError";
import type { Project, ProjectCreate, ProjectPatch, Workspace } from "../../shared/api/types";
import {
  AcknowledgeWorkTrackerOnboardingDocument,
  CreateWorkTrackerProjectDocument,
  DeleteWorkTrackerProjectDocument,
  UpdateWorkTrackerProjectDocument,
} from "./generated/projects.documents";

async function graphQl<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    return graphQlMutationError(error);
  }
}

export function acknowledgeOnboarding(): Promise<Workspace> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => (
      await execute(AcknowledgeWorkTrackerOnboardingDocument, {})
    ).acknowledge_onboarding as Workspace),
  });
}

export function createProject(body: ProjectCreate): Promise<Project> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => (
      await execute(CreateWorkTrackerProjectDocument, {
        name: body.name,
        slug: body.slug,
        description: body.description,
      })
    ).create_project as Project),
  });
}

export function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => (
      await execute(UpdateWorkTrackerProjectDocument, {
        id,
        name: patch.name,
        description: patch.description,
      })
    ).update_project as Project),
  });
}

export function deleteProject(id: string): Promise<void> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => {
      await execute(DeleteWorkTrackerProjectDocument, { id });
    }),
  });
}
