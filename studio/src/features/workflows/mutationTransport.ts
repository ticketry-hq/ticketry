import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { studioRuntime } from "../../runtime";
import { publicResult, serverVariables } from "../../shared/api/worktrackerConversion";
import { selectIssueTypeLevel } from "./selectors/issueTypeLevel";
import { graphQlMutationError } from "../../shared/api/graphqlError";
import type { IssueTypeCreate, IssueTypePatch, LaunchBindingInput, State, StateCreate, StatePatch } from "./types";
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
import {
  getWorkflowCatalogSnapshot,
  readWorkflowCatalog,
} from "./queries/projectCatalog";

async function graphQl<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try { return await operation(); } catch (error) { return graphQlMutationError(error); }
}

/** Authored workflow operations always carry a generated selection document. */
type WorkflowExecute = <Result, Variables>(
  document: TypedDocumentNode<Result, Variables>, variables: Variables,
) => Promise<Result>;

function writeWorkflow<Result>(operation: (execute: WorkflowExecute) => Promise<Result>): Promise<Result> {
  return studioRuntime().writeWorkTracker({
    graphQl: (execute) => graphQl(() => operation(async (document, variables) =>
      publicResult(document, await execute(document, serverVariables(document, variables)))
    )),
  });
}

export function createIssueType(projectId: string, body: IssueTypeCreate) {
  return writeWorkflow(async (execute) => selectIssueTypeLevel((await execute(CreateWorkTrackerIssueTypeDocument, {
    projectId, name: body.name, level: body.level, color: body.color,
  })).create_issue_type));
}

export function updateIssueType(id: string, patch: IssueTypePatch) {
  return writeWorkflow(async (execute) => selectIssueTypeLevel((await execute(UpdateWorkTrackerIssueTypeDocument, {
    id, name: patch.name, color: patch.color, sortOrder: patch.sortOrder,
  })).update_issue_type));
}

export function deleteIssueType(id: string, reassignTo?: string): Promise<void> {
  return writeWorkflow(async (execute) => { await execute(DeleteWorkTrackerIssueTypeDocument, { id, reassignTo }); });
}

export function reorderIssueTypes(projectId: string, orderedIds: string[]) {
  return writeWorkflow(async (execute) => (await execute(ReorderWorkTrackerIssueTypesDocument, { projectId, orderedIds })).reorder_issue_types.map(selectIssueTypeLevel));
}

export function createState(projectId: string, body: StateCreate): Promise<State> {
  return writeWorkflow(async (execute) => (await execute(CreateWorkTrackerStateDocument, {
    projectId, name: body.name, group: body.group, color: body.color,
  })).create_state);
}

export function updateState(id: string, patch: StatePatch): Promise<State> {
  return writeWorkflow(async (execute) => (await execute(UpdateWorkTrackerStateDocument, {
    id, name: patch.name, group: patch.group, color: patch.color, sortOrder: patch.sortOrder,
  })).update_state);
}

export function deleteState(id: string, reassignTo?: string): Promise<void> {
  void reassignTo;
  return writeWorkflow(async (execute) => { await execute(DeleteWorkTrackerStateDocument, { id }); });
}

export function reorderStates(projectId: string, orderedIds: string[]): Promise<State[]> {
  return writeWorkflow(async (execute) => (await execute(ReorderWorkTrackerStatesDocument, { projectId, orderedIds })).reorder_states);
}

export function setIssueTypeWorkflowStartState(typeId: string, stateId: string, revision: number): Promise<unknown> {
  return writeWorkflow((execute) => execute(SetWorkTrackerStartStateDocument, { id: typeId, startStateId: stateId, workflowRevision: revision }));
}
export function addIssueTypeWorkflowTransition(typeId: string, input: { from_state_id: string; to_state_id: string; agent_allowed: boolean; handoff: boolean; workflow_revision: number }): Promise<unknown> {
  return writeWorkflow((execute) => execute(CreateWorkTrackerTransitionDocument, { issueTypeId: typeId, fromStateId: input.from_state_id, toStateId: input.to_state_id, agentAllowed: input.agent_allowed, handoff: input.handoff, workflowRevision: input.workflow_revision }));
}
export function removeIssueTypeWorkflowTransition(typeId: string, fromStateId: string, toStateId: string, revision: number): Promise<unknown> {
  return writeWorkflow((execute) => execute(DeleteWorkTrackerTransitionDocument, { issueTypeId: typeId, fromStateId, toStateId, workflowRevision: revision }));
}
export function removeIssueTypeWorkflowState(typeId: string, stateId: string, revision: number): Promise<unknown> {
  return writeWorkflow((execute) => execute(RemoveWorkTrackerWorkflowStateDocument, { issueTypeId: typeId, stateId, workflowRevision: revision }));
}
export function updateIssueTypeWorkflowTransition(typeId: string, fromStateId: string, toStateId: string, agentAllowed: boolean, handoff: boolean, revision: number): Promise<unknown> {
  return writeWorkflow((execute) => execute(UpdateWorkTrackerTransitionDocument, { issueTypeId: typeId, fromStateId, toStateId, agentAllowed, handoff, workflowRevision: revision }));
}

export function upsertIssueTypeWorkflowLaunchBinding(
  projectId: string, typeId: string, stateId: string, binding: LaunchBindingInput,
  workflowRevision: number, autoStart: boolean, subtreeRunEnabled: boolean,
): Promise<unknown> {
  return writeWorkflow(async (execute) => {
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
      ...(binding.stage_skills === undefined
        ? {}
        : { stageSkills: binding.stage_skills }),
      ...(binding.profile === undefined ? {} : { profile: binding.profile }),
      modelId: model?.id ?? null, reasoningId: reasoning?.id ?? null,
      autoStart, subtreeRunEnabled,
    });
  });
}
export function setIssueTypeWorkflowAutoStart(typeId: string, stateId: string, autoStart: boolean, revision: number): Promise<unknown> {
  return writeWorkflow((execute) => execute(SetWorkTrackerAutoStartDocument, { issueTypeId: typeId, stateId, workflowRevision: revision, autoStart }));
}
export function setIssueTypeWorkflowSubtreeRun(typeId: string, stateId: string, enabled: boolean, revision: number): Promise<unknown> {
  return writeWorkflow((execute) => execute(SetWorkTrackerSubtreeRunDocument, { issueTypeId: typeId, stateId, workflowRevision: revision, enabled }));
}
