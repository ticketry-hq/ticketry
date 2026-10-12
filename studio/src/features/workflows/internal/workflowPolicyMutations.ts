import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  CreateWorkTrackerTransitionDocument,
  DeleteWorkTrackerTransitionDocument,
  RemoveWorkTrackerWorkflowStateDocument,
  SetWorkTrackerAutoStartDocument,
  SetWorkTrackerStartStateDocument,
  SetWorkTrackerSubtreeRunDocument,
  UpdateWorkTrackerTransitionDocument,
} from "../generated/workflows.documents";
import { workflowCatalog } from "./stateMutations";

/**
 * Per-type workflow writes. Each one applies at the editor's workflow revision
 * (a stale revision fails as a 409), and each one makes the project's workflow
 * catalog stale, which is also the read every per-type workflow settings view
 * is projected from.
 */
export interface WorkflowPolicyWrite {
  projectId: string;
  typeId: string;
  workflowRevision: number;
}

const refreshCatalog = ({ projectId }: WorkflowPolicyWrite) => [workflowCatalog(projectId)];

export interface StartStateWrite extends WorkflowPolicyWrite {
  stateId: string;
}

export const startStateMutation = declareMutation({
  document: SetWorkTrackerStartStateDocument,
  variables: ({ typeId, stateId, workflowRevision }: StartStateWrite) => ({
    id: typeId,
    startStateId: stateId,
    workflowRevision,
  }),
  root: "update_issue_type",
  refresh: refreshCatalog,
});

export interface TransitionWrite extends WorkflowPolicyWrite {
  fromStateId: string;
  toStateId: string;
}

export interface TransitionPolicyWrite extends TransitionWrite {
  agentAllowed: boolean;
  handoff: boolean;
}

const transitionPolicyVariables = ({
  typeId, fromStateId, toStateId, agentAllowed, handoff, workflowRevision,
}: TransitionPolicyWrite) => ({
  issueTypeId: typeId,
  fromStateId,
  toStateId,
  agentAllowed,
  handoff,
  workflowRevision,
});

export const transitionCreationMutation = declareMutation({
  document: CreateWorkTrackerTransitionDocument,
  variables: transitionPolicyVariables,
  root: "create_issue_type_transition",
  refresh: refreshCatalog,
});

/** Change one existing transition's agent permission or handoff. */
export const transitionUpdateMutation = declareMutation({
  document: UpdateWorkTrackerTransitionDocument,
  variables: transitionPolicyVariables,
  root: "update_issue_type_transition",
  refresh: refreshCatalog,
});

export const transitionDeletionMutation = declareMutation({
  document: DeleteWorkTrackerTransitionDocument,
  variables: ({ typeId, fromStateId, toStateId, workflowRevision }: TransitionWrite) => ({
    issueTypeId: typeId,
    fromStateId,
    toStateId,
    workflowRevision,
  }),
  root: "delete_issue_type_transition",
  refresh: refreshCatalog,
});

export interface WorkflowStateWrite extends WorkflowPolicyWrite {
  stateId: string;
}

/** Remove a state from one type's workflow, the quarantined domain operation. */
export const workflowStateRemovalMutation = declareMutation({
  document: RemoveWorkTrackerWorkflowStateDocument,
  variables: ({ typeId, stateId, workflowRevision }: WorkflowStateWrite) => ({
    issueTypeId: typeId,
    stateId,
    workflowRevision,
  }),
  root: "remove_state_from_issue_type_workflow",
  refresh: refreshCatalog,
});

export interface AutoStartWrite extends WorkflowStateWrite {
  autoStart: boolean;
}

export const autoStartMutation = declareMutation({
  document: SetWorkTrackerAutoStartDocument,
  variables: ({ typeId, stateId, workflowRevision, autoStart }: AutoStartWrite) => ({
    issueTypeId: typeId,
    stateId,
    workflowRevision,
    autoStart,
  }),
  root: "upsert_issue_type_launch_binding",
  refresh: refreshCatalog,
});

export interface SubtreeRunWrite extends WorkflowStateWrite {
  enabled: boolean;
}

export const subtreeRunMutation = declareMutation({
  document: SetWorkTrackerSubtreeRunDocument,
  variables: ({ typeId, stateId, workflowRevision, enabled }: SubtreeRunWrite) => ({
    issueTypeId: typeId,
    stateId,
    workflowRevision,
    enabled,
  }),
  root: "upsert_issue_type_launch_binding",
  refresh: refreshCatalog,
});
