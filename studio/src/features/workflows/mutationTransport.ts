import { executeDeclaredMutation } from "../../shared/apollo/declaredMutation";
import type {
  IssueType, IssueTypeCreate, IssueTypePatch, LaunchBindingInput,
  State, StateCreate, StatePatch,
} from "../../shared/api/types";
import {
  issueTypeCreationMutation,
  issueTypeDeletionMutation,
  issueTypeReorderMutation,
  issueTypeUpdateMutation,
} from "./internal/issueTypeMutations";
import {
  launchBindingUpsertMutation,
  resolveLaunchBindingCatalog,
} from "./internal/launchBindingUpsert";
import {
  stateCreationMutation,
  stateDeletionMutation,
  stateReorderMutation,
  stateUpdateMutation,
} from "./internal/stateMutations";
import {
  autoStartMutation,
  startStateMutation,
  subtreeRunMutation,
  transitionCreationMutation,
  transitionDeletionMutation,
  transitionUpdateMutation,
  workflowStateRemovalMutation,
} from "./internal/workflowPolicyMutations";

export function createIssueType(projectId: string, body: IssueTypeCreate): Promise<IssueType> {
  return executeDeclaredMutation(issueTypeCreationMutation, { projectId, body });
}

export function updateIssueType(id: string, patch: IssueTypePatch): Promise<IssueType> {
  return executeDeclaredMutation(issueTypeUpdateMutation, { id, patch });
}

export function deleteIssueType(projectId: string, id: string, reassignTo?: string): Promise<void> {
  return executeDeclaredMutation(issueTypeDeletionMutation, { projectId, id, reassignTo });
}

export function reorderIssueTypes(projectId: string, orderedIds: string[]): Promise<IssueType[]> {
  return executeDeclaredMutation(issueTypeReorderMutation, { projectId, orderedIds });
}

export function createState(projectId: string, body: StateCreate): Promise<State> {
  return executeDeclaredMutation(stateCreationMutation, { projectId, body });
}

export function updateState(id: string, patch: StatePatch): Promise<State> {
  return executeDeclaredMutation(stateUpdateMutation, { id, patch });
}

/** `reassignTo` is accepted and ignored: deleting a state never reassigns work. */
export function deleteState(projectId: string, id: string, reassignTo?: string): Promise<void> {
  void reassignTo;
  return executeDeclaredMutation(stateDeletionMutation, { projectId, id });
}

export function reorderStates(projectId: string, orderedIds: string[]): Promise<State[]> {
  return executeDeclaredMutation(stateReorderMutation, { projectId, orderedIds });
}

export function setIssueTypeWorkflowStartState(
  projectId: string, typeId: string, stateId: string, workflowRevision: number,
): Promise<unknown> {
  return executeDeclaredMutation(startStateMutation, { projectId, typeId, stateId, workflowRevision });
}

export function addIssueTypeWorkflowTransition(
  projectId: string,
  typeId: string,
  input: { from_state_id: string; to_state_id: string; agent_allowed: boolean; handoff: boolean; workflow_revision: number },
): Promise<unknown> {
  return executeDeclaredMutation(transitionCreationMutation, {
    projectId,
    typeId,
    fromStateId: input.from_state_id,
    toStateId: input.to_state_id,
    agentAllowed: input.agent_allowed,
    handoff: input.handoff,
    workflowRevision: input.workflow_revision,
  });
}

export function removeIssueTypeWorkflowTransition(
  projectId: string, typeId: string, fromStateId: string, toStateId: string, workflowRevision: number,
): Promise<unknown> {
  return executeDeclaredMutation(transitionDeletionMutation, {
    projectId, typeId, fromStateId, toStateId, workflowRevision,
  });
}

export function removeIssueTypeWorkflowState(
  projectId: string, typeId: string, stateId: string, workflowRevision: number,
): Promise<unknown> {
  return executeDeclaredMutation(workflowStateRemovalMutation, {
    projectId, typeId, stateId, workflowRevision,
  });
}

export function updateIssueTypeWorkflowTransition(
  projectId: string, typeId: string, fromStateId: string, toStateId: string,
  agentAllowed: boolean, handoff: boolean, workflowRevision: number,
): Promise<unknown> {
  return executeDeclaredMutation(transitionUpdateMutation, {
    projectId, typeId, fromStateId, toStateId, agentAllowed, handoff, workflowRevision,
  });
}

export async function upsertIssueTypeWorkflowLaunchBinding(
  projectId: string, typeId: string, stateId: string, binding: LaunchBindingInput,
  workflowRevision: number, autoStart: boolean, subtreeRunEnabled: boolean,
): Promise<unknown> {
  const upsert = await resolveLaunchBindingCatalog({
    projectId, typeId, stateId, binding, workflowRevision, autoStart, subtreeRunEnabled,
  });
  return executeDeclaredMutation(launchBindingUpsertMutation, upsert);
}

export function setIssueTypeWorkflowAutoStart(
  projectId: string, typeId: string, stateId: string, autoStart: boolean, workflowRevision: number,
): Promise<unknown> {
  return executeDeclaredMutation(autoStartMutation, {
    projectId, typeId, stateId, autoStart, workflowRevision,
  });
}

export function setIssueTypeWorkflowSubtreeRun(
  projectId: string, typeId: string, stateId: string, enabled: boolean, workflowRevision: number,
): Promise<unknown> {
  return executeDeclaredMutation(subtreeRunMutation, {
    projectId, typeId, stateId, enabled, workflowRevision,
  });
}
