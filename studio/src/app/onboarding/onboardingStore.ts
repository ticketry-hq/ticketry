import { useQuery } from "@apollo/client/react";
import {
  acknowledgeOnboarding as writeOnboardingAcknowledgement,
  readWorkspace,
  WorkTrackerWorkspaceDocument,
} from "../../features/projects";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";

function workspaceQueryData(nodes: Array<{
  id: string;
  slug: string;
  name: string;
  onboarding_required: boolean;
}>) {
  return {
    workspace: {
      __typename: "WorktrackerWorkspaceConnection",
      nodes: nodes.map((workspace) => ({
        __typename: "WorktrackerWorkspace",
        ...workspace,
      })),
    },
  };
}

export async function loadWorkspaceState(): Promise<void> {
  try {
    const workspace = await readWorkspace();
    studioApolloClient().writeQuery({
      query: WorkTrackerWorkspaceDocument,
      data: workspaceQueryData([{
        id: compactWorktrackerId(workspace.id),
        slug: workspace.slug,
        name: workspace.name,
        onboarding_required: workspace.onboarding_required,
      }]),
    });
  } catch (error) {
    // A flaky workspace endpoint must not strand an existing user during
    // bootstrap. Absence is deliberately interpreted as no pending welcome.
    console.warn("[onboarding] workspace state load failed", error);
    studioApolloClient().writeQuery({
      query: WorkTrackerWorkspaceDocument,
      data: workspaceQueryData([]),
    });
  }
}

export async function acknowledgeOnboarding(): Promise<void> {
  const workspace = await writeOnboardingAcknowledgement();
  studioApolloClient().writeQuery({
    query: WorkTrackerWorkspaceDocument,
    data: workspaceQueryData([{
      id: compactWorktrackerId(workspace.id),
      slug: workspace.slug,
      name: workspace.name,
      onboarding_required: workspace.onboarding_required,
    }]),
  });
}

export function getOnboardingRequiredSnapshot(): boolean {
  return studioApolloClient().readQuery({ query: WorkTrackerWorkspaceDocument })
    ?.workspace.nodes[0]?.onboarding_required ?? false;
}

export function useOnboardingRequired(): boolean {
  const { data } = useQuery(WorkTrackerWorkspaceDocument, {
    client: studioApolloClient(),
    fetchPolicy: "cache-only",
  });
  return data?.workspace.nodes[0]?.onboarding_required ?? false;
}
