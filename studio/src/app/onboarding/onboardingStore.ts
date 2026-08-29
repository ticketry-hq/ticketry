import { useQuery } from "@apollo/client/react";
import {
  acknowledgeOnboarding as writeOnboardingAcknowledgement,
  readOnboardingProjects,
  WorkTrackerOnboardingDocument,
} from "../../features/projects";
import type { OnboardingProject } from "../../features/projects";
import {
  DEFAULT_PROJECT_KEY,
  LEGACY_PROJECT_KEY,
} from "../../features/studio/lib/defaultProject";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";

type CachedProject = {
  id: string;
  slug: string;
  name: string;
  onboarding_required: boolean;
};

function onboardingQueryData(nodes: CachedProject[]) {
  return {
    projects: {
      __typename: "WorktrackerProjectConnection",
      nodes: nodes.map((project) => ({
        __typename: "WorktrackerProject",
        ...project,
      })),
    },
  };
}

/**
 * The installation's own project, resolved the way the rest of the app resolves
 * it: a recognized slug first, then the oldest project. The query already
 * returns creation order, so the first node is the oldest.
 */
function installationProject<T extends { slug: string }>(
  nodes: readonly T[],
): T | null {
  return (
    nodes.find((project) => project.slug === DEFAULT_PROJECT_KEY) ??
    nodes.find((project) => project.slug === LEGACY_PROJECT_KEY) ??
    nodes[0] ??
    null
  );
}

/**
 * Whether first-run onboarding is still pending.
 *
 * An installation with no project has never been set up, so onboarding is
 * pending by definition. Once a project exists, that project owns the answer.
 */
function onboardingRequired(
  nodes: readonly { slug: string; onboarding_required: boolean }[],
): boolean {
  const project = installationProject(nodes);
  return project ? project.onboarding_required : nodes.length === 0;
}

function cached(): readonly CachedProject[] | null {
  const data = studioApolloClient().readQuery({
    query: WorkTrackerOnboardingDocument,
  });
  return data?.projects.nodes ?? null;
}

function write(projects: OnboardingProject[]): void {
  studioApolloClient().writeQuery({
    query: WorkTrackerOnboardingDocument,
    data: onboardingQueryData(
      projects.map((project) => ({
        id: compactWorktrackerId(project.id),
        slug: project.slug,
        name: project.name,
        onboarding_required: project.onboarding_required,
      })),
    ),
  });
}

export async function loadOnboardingState(): Promise<void> {
  try {
    write(await readOnboardingProjects());
  } catch (error) {
    // A flaky project endpoint must not strand an existing user during
    // bootstrap, and it must not be mistaken for a first run either. Leaving
    // the cache unwritten keeps "unreadable" distinct from "no project yet":
    // the readers below answer "no pending welcome" for the first and "welcome
    // pending" only for the second.
    console.warn("[onboarding] project state load failed", error);
  }
}

export async function acknowledgeOnboarding(projectId: string): Promise<void> {
  const project = await writeOnboardingAcknowledgement(projectId);
  const acknowledged = {
    id: compactWorktrackerId(project.id),
    slug: project.slug,
    name: project.name,
    onboarding_required: project.onboarding_required,
  };
  const nodes = cached() ?? [];
  const known = nodes.some((node) => node.id === acknowledged.id);
  studioApolloClient().writeQuery({
    query: WorkTrackerOnboardingDocument,
    data: onboardingQueryData(
      known
        ? nodes.map((node) => (node.id === acknowledged.id ? acknowledged : node))
        : [...nodes, acknowledged],
    ),
  });
}

export function getOnboardingRequiredSnapshot(): boolean {
  const nodes = cached();
  return nodes ? onboardingRequired(nodes) : false;
}

export function useOnboardingRequired(): boolean {
  const { data } = useQuery(WorkTrackerOnboardingDocument, {
    client: studioApolloClient(),
    fetchPolicy: "cache-only",
  });
  return data ? onboardingRequired(data.projects.nodes) : false;
}
