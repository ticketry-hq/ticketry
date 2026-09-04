import { useQuery } from "@apollo/client/react";

import { studioApolloClient } from "../../shared/apollo/client";
import {
  ModuleAppRunStatusDocument,
  ModuleRunConfigurationDocument,
} from "./generated/appRun.documents";

export function useModuleAppRun(moduleId: string | null) {
  const configuration = useQuery(ModuleRunConfigurationDocument, {
    client: studioApolloClient(),
    variables: { moduleId: moduleId ?? "" },
    skip: !moduleId,
  });
  const status = useQuery(ModuleAppRunStatusDocument, {
    client: studioApolloClient(),
    variables: { moduleId: moduleId ?? "" },
    skip: !moduleId,
    pollInterval: 2_000,
  });
  return {
    configuration: configuration.data?.run_configurations?.nodes?.[0] ?? null,
    live: status.data?.app_run?.live ?? false,
    runId: status.data?.app_run?.run_id ?? null,
    loading: configuration.loading || status.loading,
    refetch: async () => {
      await Promise.all([configuration.refetch(), status.refetch()]);
    },
  };
}
