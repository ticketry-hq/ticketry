import { useQuery } from "@tanstack/react-query";
import * as api from "../../shared/api/client";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import {
  getProjectsSnapshot,
  loadProjects,
} from "../../features/projects/queries";
import { findDefaultProject } from "../../features/studio/lib/defaultProject";

async function fetchOnboardingRequired(): Promise<boolean> {
  const project = findDefaultProject(await loadProjects());
  return project?.onboarding_required ?? false;
}

export async function loadProjectOnboardingState(): Promise<void> {
  try {
    await queryClient.fetchQuery({
      queryKey: queryKeys.onboarding,
      queryFn: fetchOnboardingRequired,
      staleTime: 0,
    });
  } catch (error) {
    // A flaky project endpoint must not strand an existing user during
    // bootstrap. Absence is deliberately interpreted as no pending welcome.
    console.warn("[onboarding] project state load failed", error);
    queryClient.setQueryData(queryKeys.onboarding, false);
  }
}

export async function acknowledgeOnboarding(): Promise<void> {
  const project = findDefaultProject(getProjectsSnapshot());
  if (!project) throw new Error("The default project is unavailable.");
  const updated = await api.acknowledgeProjectOnboarding(project.id);
  queryClient.setQueryData(
    queryKeys.onboarding,
    updated.onboarding_required,
  );
}

export function getOnboardingRequiredSnapshot(): boolean {
  return queryClient.getQueryData<boolean>(queryKeys.onboarding) ?? false;
}

export function useOnboardingRequired(): boolean {
  const { data } = useQuery(
    {
      queryKey: queryKeys.onboarding,
      queryFn: fetchOnboardingRequired,
      enabled: false,
    },
    queryClient,
  );
  return data ?? false;
}
