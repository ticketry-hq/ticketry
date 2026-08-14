import { useQuery } from "@tanstack/react-query";
import * as api from "../../shared/api/client";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";

async function fetchOnboardingRequired(): Promise<boolean> {
  return (await api.getWorkspace()).onboarding_required;
}

export async function loadWorkspaceState(): Promise<void> {
  try {
    await queryClient.fetchQuery({
      queryKey: queryKeys.workspace,
      queryFn: fetchOnboardingRequired,
      staleTime: 0,
    });
  } catch (error) {
    // A flaky workspace endpoint must not strand an existing user during
    // bootstrap. Absence is deliberately interpreted as no pending welcome.
    console.warn("[onboarding] workspace state load failed", error);
    queryClient.setQueryData(queryKeys.workspace, false);
  }
}

export async function acknowledgeOnboarding(): Promise<void> {
  const workspace = await api.acknowledgeOnboarding();
  queryClient.setQueryData(
    queryKeys.workspace,
    workspace.onboarding_required,
  );
}

export function getOnboardingRequiredSnapshot(): boolean {
  return queryClient.getQueryData<boolean>(queryKeys.workspace) ?? false;
}

export function useOnboardingRequired(): boolean {
  const { data } = useQuery(
    {
      queryKey: queryKeys.workspace,
      queryFn: fetchOnboardingRequired,
      enabled: false,
    },
    queryClient,
  );
  return data ?? false;
}
