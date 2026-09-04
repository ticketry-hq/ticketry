import {
  studioRuntime,
  type WorkTrackerGraphQlExecute,
} from "../../../runtime";
import { graphQlMutationError } from "../../../shared/api/graphqlError";
import {
  CreateRunConfigurationDocument,
  StartAppRunDocument,
  StopAppRunDocument,
  UpdateRunConfigurationDocument,
} from "../generated/appRun.documents";

export interface EditableRunConfiguration {
  moduleId: string;
  command: string;
  environment: Record<string, string>;
  previewUrl: string | null;
}

async function write<TResult>(
  operation: {
    graphQl: (execute: WorkTrackerGraphQlExecute) => Promise<TResult>;
  },
): Promise<TResult> {
  return studioRuntime().writeWorkTracker(operation);
}

export async function saveRunConfiguration(
  configured: boolean,
  input: EditableRunConfiguration,
): Promise<void> {
  await write({
    graphQl: async (execute) => {
      try {
        const variables = {
          moduleId: input.moduleId,
          command: input.command,
          environment: input.environment,
          previewUrl: input.previewUrl,
        };
        return configured
          ? await execute(UpdateRunConfigurationDocument, variables)
          : await execute(CreateRunConfigurationDocument, variables);
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
}

export async function startAppRun(moduleId: string): Promise<{ runId: string }> {
  const result = await write<{ app_run: { run_id: string } }>({
    graphQl: async (execute) => {
      try {
        return await execute(StartAppRunDocument, {
          moduleId,
          columns: 80,
          rows: 24,
        });
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
  return { runId: result.app_run.run_id };
}

export async function stopAppRun(moduleId: string): Promise<void> {
  await write({
    graphQl: async (execute) => {
      try {
        return await execute(StopAppRunDocument, { moduleId });
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
}
