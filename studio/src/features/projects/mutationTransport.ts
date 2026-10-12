import type { OnboardingProject, Project, ProjectCreate, ProjectPatch } from "../../shared/api/types";
import { executeDeclaredMutation } from "../../shared/apollo/declaredMutation";
import { onboardingAcknowledgementMutation } from "./internal/onboardingAcknowledgementMutation";
import {
  projectCreationMutation,
  projectDeletionMutation,
  projectUpdateMutation,
} from "./internal/projectMutations";

export function acknowledgeOnboarding(projectId: string): Promise<OnboardingProject> {
  return executeDeclaredMutation(onboardingAcknowledgementMutation, projectId);
}

export function createProject(body: ProjectCreate): Promise<Project> {
  return executeDeclaredMutation(projectCreationMutation, body);
}

export function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  return executeDeclaredMutation(projectUpdateMutation, { id, patch });
}

export function deleteProject(id: string): Promise<void> {
  return executeDeclaredMutation(projectDeletionMutation, id);
}
