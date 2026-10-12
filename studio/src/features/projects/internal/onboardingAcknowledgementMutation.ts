import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { OnboardingProject } from "../../../shared/api/types";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  AcknowledgeWorkTrackerOnboardingDocument,
  WorkTrackerOnboardingDocument,
  type WorkTrackerOnboardingQuery,
} from "../generated/projects.documents";

/**
 * Acknowledge first-run onboarding: the quarantined domain operation.
 *
 * It makes exactly one read stale, the onboarding read that decides whether
 * the welcome replaces the shell. The authoritative row converges it in place
 * (or joins it when the read has not seen that project); no follow-up read is
 * sent, as before.
 */
export const onboardingAcknowledgementMutation = declareMutation({
  document: AcknowledgeWorkTrackerOnboardingDocument,
  variables: (projectId: string) => ({ projectId }),
  root: "acknowledge_onboarding",
  membership: (cache, project) => {
    const acknowledged = { ...project, id: compactWorktrackerId(project.id) };
    const nodes = cache.readQuery({ query: WorkTrackerOnboardingDocument })
      ?.projects.nodes ?? [];
    const known = nodes.some((node) => compactWorktrackerId(node.id) === acknowledged.id);
    cache.writeQuery({
      query: WorkTrackerOnboardingDocument,
      data: {
        projects: {
          __typename: "WorktrackerProjectConnection",
          nodes: known
            ? nodes.map((node) =>
              compactWorktrackerId(node.id) === acknowledged.id ? acknowledged : node)
            : [...nodes, acknowledged],
        },
      } as WorkTrackerOnboardingQuery,
    });
  },
  result: (project) => project as OnboardingProject,
});
