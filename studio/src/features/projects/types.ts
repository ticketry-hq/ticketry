import type {
  WorkTrackerProjectsQuery,
  WorkTrackerOnboardingQuery,
  WorkTrackerProjectOpenQuery,
  CreateWorkTrackerProjectMutationVariables,
  CreateWorkTrackerProjectMutation,
  UpdateWorkTrackerProjectMutationVariables,
} from "./generated/projects.documents";

/** The shared conversion seam preserves the generated selection's shape. */
export type Project = WorkTrackerProjectsQuery["projects"]["nodes"][number];
export type OnboardingProject = WorkTrackerOnboardingQuery["projects"]["nodes"][number];
/** Retained domain view: the module key is derived from project slug and sequence. */
export type Module = WorkTrackerProjectOpenQuery["modules"]["nodes"][number] & { readonly key: string };
export type ProjectCreate = CreateWorkTrackerProjectMutationVariables;
export type ProjectPatch = UpdateWorkTrackerProjectMutationVariables;

/** Creation selects no timestamp; return its generated row without inventing one. */
export type ProjectCreateResult = CreateWorkTrackerProjectMutation["create_project"];
