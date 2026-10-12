import { studioRuntime } from "../../runtime";
import { graphQlMutationError } from "../../shared/api/graphqlError";
import { publicResult, serverVariables } from "../../shared/api/worktrackerConversion";
import {
  AcknowledgeWorkTrackerOnboardingDocument,
  CreateWorkTrackerProjectDocument,
  DeleteWorkTrackerProjectDocument,
  UpdateWorkTrackerProjectDocument,
  type CreateWorkTrackerProjectMutationVariables,
  type UpdateWorkTrackerProjectMutationVariables,
} from "./generated/projects.documents";

async function graphQl<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    return graphQlMutationError(error);
  }
}

export function acknowledgeOnboarding(projectId: string) {
  const document = AcknowledgeWorkTrackerOnboardingDocument;
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => publicResult(document,
      await execute(document, serverVariables(document, { projectId })),
    ).acknowledge_onboarding),
  });
}

export function createProject(body: CreateWorkTrackerProjectMutationVariables) {
  const document = CreateWorkTrackerProjectDocument;
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => publicResult(document,
      await execute(document, serverVariables(document, {
        name: body.name,
        slug: body.slug,
        description: body.description,
      })),
    ).create_project),
  });
}

export function updateProject(variables: UpdateWorkTrackerProjectMutationVariables) {
  const document = UpdateWorkTrackerProjectDocument;
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => publicResult(document,
      await execute(document, serverVariables(document, {
        id: variables.id,
        name: variables.name,
        description: variables.description,
      })),
    ).update_project),
  });
}

export function deleteProject(id: string): Promise<void> {
  const document = DeleteWorkTrackerProjectDocument;
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => {
      await execute(document, serverVariables(document, { id }));
    }),
  });
}
