import type { LaunchBindingInput } from "../../../shared/api/types";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import { UpsertWorkTrackerLaunchBindingDocument } from "../generated/workflows.documents";
import {
  getWorkflowCatalogSnapshot,
  readWorkflowCatalog,
} from "../queries/projectCatalog";
import { workflowCatalog } from "./stateMutations";
import type { WorkflowStateWrite } from "./workflowPolicyMutations";

export interface LaunchBindingUpsert extends WorkflowStateWrite {
  binding: LaunchBindingInput;
  autoStart: boolean;
  subtreeRunEnabled: boolean;
}

/** An upsert whose provider, model and reasoning resolved to catalog rows. */
export interface ResolvedLaunchBindingUpsert extends LaunchBindingUpsert {
  modelId: string | null;
  reasoningId: string | null;
}

/**
 * Resolve the binding's provider, model and reasoning names against the
 * project's workflow catalog, reading it from the network when no read has
 * cached it. Unknown catalog entries are rejected before anything is sent.
 */
export async function resolveLaunchBindingCatalog(
  upsert: LaunchBindingUpsert,
): Promise<ResolvedLaunchBindingUpsert> {
  const { binding, projectId } = upsert;
  const catalog = getWorkflowCatalogSnapshot(projectId)
    ?? await readWorkflowCatalog(projectId, "network-only");
  const provider = binding.agent
    ? catalog.providers.find((row) => row.slug === binding.agent)
    : undefined;
  const model = binding.model
    ? catalog.agentModels.find((row) =>
        row.name === binding.model
        && (!provider || row.provider === provider.id || row.provider === provider.slug)
      )
    : undefined;
  const reasoning = binding.reasoning
    ? catalog.reasoningLevels.find((row) => row.name === binding.reasoning)
    : undefined;
  if (binding.agent && !provider) throw new Error(`Agent/provider '${binding.agent}' is not in the catalog.`);
  // A launch binding records its provider through the chosen model or
  // profile, the only agent identity the row carries, so an agent without
  // either is the empty inheriting binding. Clearing the profile
  // ("No profile") arrives that way; rejecting it left the cleared profile
  // persisted (ticket #1824). Write the cleared row instead of restoring
  // the overrides the caller just dropped.
  if (binding.model && !model) throw new Error(`Model '${binding.model}' is not in the catalog for agent/provider '${binding.agent ?? ""}'.`);
  if (binding.reasoning && !reasoning) throw new Error(`Reasoning '${binding.reasoning}' is not in the catalog.`);
  return { ...upsert, modelId: model?.id ?? null, reasoningId: reasoning?.id ?? null };
}

/** Create or replace one state's launch binding at the editor's workflow revision. */
export const launchBindingUpsertMutation = declareMutation({
  document: UpsertWorkTrackerLaunchBindingDocument,
  // `prompt` and `required_skills` are omitted when the caller supplied
  // neither. Coercing an absent value to `""`/`[]` turned "leave this
  // alone" into "clear it", so a partial edit erased a configured prompt
  // and every launch for that type/state then failed with
  // `prompt_not_configured` (ticket #1372).
  variables: ({
    typeId, stateId, workflowRevision, binding, modelId, reasoningId, autoStart, subtreeRunEnabled,
  }: ResolvedLaunchBindingUpsert) => ({
    issueTypeId: typeId, stateId, workflowRevision,
    ...(binding.prompt === undefined ? {} : { prompt: binding.prompt }),
    ...(binding.required_skills === undefined
      ? {}
      : { requiredSkills: binding.required_skills }),
    ...(binding.stage_skills === undefined
      ? {}
      : { stageSkills: binding.stage_skills }),
    ...(binding.profile === undefined ? {} : { profile: binding.profile }),
    modelId, reasoningId,
    autoStart, subtreeRunEnabled,
  }),
  root: "upsert_issue_type_launch_binding",
  refresh: ({ projectId }) => [workflowCatalog(projectId)],
});
