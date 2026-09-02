import { studioRuntime } from "../../runtime";
import { graphQlMutationError } from "../../shared/api/graphqlError";
import type {
  IssueType, IssueTypeCreate, IssueTypePatch, LaunchBindingInput,
  State, StateCreate, StatePatch,
} from "../../shared/api/types";
import {
  CreateWorkTrackerIssueTypeDocument,
  CreateWorkTrackerStateDocument,
  CreateWorkTrackerTransitionDocument,
  DeleteWorkTrackerIssueTypeDocument,
  DeleteWorkTrackerStateDocument,
  DeleteWorkTrackerTransitionDocument,
  RemoveWorkTrackerWorkflowStateDocument,
  ReorderWorkTrackerIssueTypesDocument,
  ReorderWorkTrackerStatesDocument,
  SetWorkTrackerAutoStartDocument,
  SetWorkTrackerStartStateDocument,
  SetWorkTrackerSubtreeRunDocument,
  UpdateWorkTrackerIssueTypeDocument,
  UpdateWorkTrackerStateDocument,
  UpdateWorkTrackerTransitionDocument,
  UpsertWorkTrackerLaunchBindingDocument,
} from "./generated/workflows.documents";
import type { CreateWorkTrackerIssueTypeMutation } from "./generated/workflows.documents";
import {
  getWorkflowCatalogSnapshot,
  readWorkflowCatalog,
} from "./queries/projectCatalog";

async function graphQl<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try { return await operation(); } catch (error) { return graphQlMutationError(error); }
}

type WorkTrackerIssueType = CreateWorkTrackerIssueTypeMutation["create_issue_type"];

const issueType = (row: WorkTrackerIssueType): IssueType => ({
  id: row.id, project: row.project, name: row.name, level: row.level as IssueType["level"],
  color: row.color, sort_order: row.sort_order, start_state: row.start_state,
  workflow_revision: row.workflow_revision,
});

export function createIssueType(projectId: string, body: IssueTypeCreate): Promise<IssueType> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => issueType((await execute(CreateWorkTrackerIssueTypeDocument, {
      projectId, name: body.name, level: body.level, color: body.color,
    })).create_issue_type)),
  });
}

export function updateIssueType(id: string, patch: IssueTypePatch): Promise<IssueType> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => issueType((await execute(UpdateWorkTrackerIssueTypeDocument, {
      id, name: patch.name, color: patch.color, sortOrder: patch.sort_order,
    })).update_issue_type)),
  });
}

export function deleteIssueType(id: string, reassignTo?: string): Promise<void> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => { await execute(DeleteWorkTrackerIssueTypeDocument, { id, reassignTo }); }),
  });
}

export function reorderIssueTypes(projectId: string, orderedIds: string[]): Promise<IssueType[]> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => (await execute(ReorderWorkTrackerIssueTypesDocument, { projectId, orderedIds })).reorder_issue_types.map(issueType)),
  });
}

export function createState(projectId: string, body: StateCreate): Promise<State> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => ({ ...(await execute(CreateWorkTrackerStateDocument, {
      projectId, name: body.name, group: body.group, color: body.color,
    })).create_state })),
  });
}

export function updateState(id: string, patch: StatePatch): Promise<State> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => ({ ...(await execute(UpdateWorkTrackerStateDocument, {
      id, name: patch.name, group: patch.group, color: patch.color, sortOrder: patch.sort_order,
    })).update_state })),
  });
}

export function deleteState(id: string, reassignTo?: string): Promise<void> {
  void reassignTo;
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => { await execute(DeleteWorkTrackerStateDocument, { id }); }),
  });
}

export function reorderStates(projectId: string, orderedIds: string[]): Promise<State[]> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => (await execute(ReorderWorkTrackerStatesDocument, { projectId, orderedIds })).reorder_states.map((row) => ({ ...row }))),
  });
}

export function setIssueTypeWorkflowStartState(typeId: string, stateId: string, revision: number): Promise<unknown> {
  return studioRuntime().writeWorkTracker<unknown>({ graphQl: (execute) => graphQl(() => execute(SetWorkTrackerStartStateDocument, { id: typeId, startStateId: stateId, workflowRevision: revision })) });
}
export function addIssueTypeWorkflowTransition(typeId: string, input: { from_state_id: string; to_state_id: string; agent_allowed: boolean; handoff: boolean; workflow_revision: number }): Promise<unknown> {
  return studioRuntime().writeWorkTracker({ graphQl: (execute) => graphQl(() => execute(CreateWorkTrackerTransitionDocument, { issueTypeId: typeId, fromStateId: input.from_state_id, toStateId: input.to_state_id, agentAllowed: input.agent_allowed, handoff: input.handoff, workflowRevision: input.workflow_revision })) });
}
export function removeIssueTypeWorkflowTransition(typeId: string, fromStateId: string, toStateId: string, revision: number): Promise<unknown> {
  return studioRuntime().writeWorkTracker<unknown>({ graphQl: (execute) => graphQl(() => execute(DeleteWorkTrackerTransitionDocument, { issueTypeId: typeId, fromStateId, toStateId, workflowRevision: revision })) });
}
export function removeIssueTypeWorkflowState(typeId: string, stateId: string, revision: number): Promise<unknown> {
  return studioRuntime().writeWorkTracker<unknown>({ graphQl: (execute) => graphQl(() => execute(RemoveWorkTrackerWorkflowStateDocument, { issueTypeId: typeId, stateId, workflowRevision: revision })) });
}
export function updateIssueTypeWorkflowTransition(typeId: string, fromStateId: string, toStateId: string, agentAllowed: boolean, handoff: boolean, revision: number): Promise<unknown> {
  return studioRuntime().writeWorkTracker({ graphQl: (execute) => graphQl(() => execute(UpdateWorkTrackerTransitionDocument, { issueTypeId: typeId, fromStateId, toStateId, agentAllowed, handoff, workflowRevision: revision })) });
}

export function upsertIssueTypeWorkflowLaunchBinding(
  projectId: string, typeId: string, stateId: string, binding: LaunchBindingInput,
  workflowRevision: number, autoStart: boolean, subtreeRunEnabled: boolean,
): Promise<unknown> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(async () => {
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
      // A launch binding records its provider through the chosen model, the
      // only agent identity the row carries. Sending the model alone silently
      // dropped an agent-without-model selection, so the state re-read as
      // unconfigured; refuse it with the reason instead.
      if (binding.agent && !binding.model) {
        throw new Error(
          `Choose a model for agent/provider '${binding.agent}'. A launch `
          + "configuration stores its provider through the model.",
        );
      }
      if (binding.model && !model) throw new Error(`Model '${binding.model}' is not in the catalog for agent/provider '${binding.agent ?? ""}'.`);
      if (binding.reasoning && !reasoning) throw new Error(`Reasoning '${binding.reasoning}' is not in the catalog.`);
      // `prompt` and `required_skills` are omitted when the caller supplied
      // neither. Coercing an absent value to `""`/`[]` turned "leave this
      // alone" into "clear it", so a partial edit erased a configured prompt
      // and every launch for that type/state then failed with
      // `prompt_not_configured` (ticket #1372).
      return execute(UpsertWorkTrackerLaunchBindingDocument, {
        issueTypeId: typeId, stateId, workflowRevision,
        ...(binding.prompt === undefined ? {} : { prompt: binding.prompt }),
        ...(binding.required_skills === undefined
          ? {}
          : { requiredSkills: binding.required_skills }),
        ...(binding.entry_skill === undefined
          ? {}
          : { entrySkill: binding.entry_skill }),
        modelId: model?.id ?? null, reasoningId: reasoning?.id ?? null,
        autoStart, subtreeRunEnabled,
      });
    }),
  });
}
export function setIssueTypeWorkflowAutoStart(typeId: string, stateId: string, autoStart: boolean, revision: number): Promise<unknown> {
  return studioRuntime().writeWorkTracker({ graphQl: (execute) => graphQl(() => execute(SetWorkTrackerAutoStartDocument, { issueTypeId: typeId, stateId, workflowRevision: revision, autoStart })) });
}
export function setIssueTypeWorkflowSubtreeRun(typeId: string, stateId: string, enabled: boolean, revision: number): Promise<unknown> {
  return studioRuntime().writeWorkTracker({ graphQl: (execute) => graphQl(() => execute(SetWorkTrackerSubtreeRunDocument, { issueTypeId: typeId, stateId, workflowRevision: revision, enabled })) });
}
