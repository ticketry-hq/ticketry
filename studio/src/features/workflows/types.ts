import type {
  GeneratedWorkTrackerIssueTypeFieldsFragment,
  GeneratedWorkTrackerStateFieldsFragment,
} from "../projects";
import type {
  CreateWorkTrackerStateMutationVariables,
  UpdateWorkTrackerStateMutationVariables,
  CreateWorkTrackerIssueTypeMutationVariables,
  UpdateWorkTrackerIssueTypeMutationVariables,
} from "./generated/workflows.documents";

/** Converted generated rows: identifiers and timestamps use the shared seam. */
export type State = GeneratedWorkTrackerStateFieldsFragment;
export type IssueLevel = "module" | "task";
/** Domain view narrows generated level strings to the two levels the workflow editor supports. */
export type IssueType = Omit<GeneratedWorkTrackerIssueTypeFieldsFragment, "level"> & { level: IssueLevel };
/** Catalog metadata edits intentionally do not own relationship rows. */
export type IssueTypeMetadata = Pick<IssueType, "id" | "project" | "name" | "level" | "color" | "sort_order" | "start_state" | "workflow_revision">;
export type WorkflowTransition = GeneratedWorkTrackerIssueTypeFieldsFragment["transitions"]["nodes"][number];
export type LaunchBinding = GeneratedWorkTrackerIssueTypeFieldsFragment["launch_bindings"]["nodes"][number];

/** Writable fields are defined by the authored operation, excluding its identity. */
export type StateCreate = Omit<CreateWorkTrackerStateMutationVariables, "projectId">;
export type StatePatch = Omit<UpdateWorkTrackerStateMutationVariables, "id">;
export type IssueTypeCreate = Omit<CreateWorkTrackerIssueTypeMutationVariables, "projectId">;
export type IssueTypePatch = Omit<UpdateWorkTrackerIssueTypeMutationVariables, "id">;

/** Partial editor input resolves provider/model identities into names and omits server-owned binding identity. */
export interface LaunchBindingInput {
  prompt?: string | null;
  required_skills?: string[] | null;
  stage_skills?: string[] | null;
  agent?: string | null;
  profile?: string | null;
  model?: string | null;
  reasoning?: string | null;
}
/** Computed usage and protection rules for a state deletion preview. */
export interface StateImpact {
  state_id: State["id"];
  total_work_items: number;
  protection_rules?: Array<{ code: string; message: string }>;
}

/** Editor graph edge projected from a generated transition. */
export interface WorkflowEdge {
  from: WorkflowTransition["from_state"];
  to: WorkflowTransition["to_state"];
  auto_launch?: boolean;
}

/** Editor topology derived from start-state and transition rows. */
export interface WorkflowGraph {
  start_state_id: IssueType["start_state"];
  terminal_state_ids: State["id"][];
  edges: WorkflowEdge[];
}

/** Scoped transition projection with generated field contracts. */
export interface ScopedWorkflowTransition {
  from_state_id: State["id"];
  to_state_id: State["id"];
  agent_allowed: WorkflowTransition["agent_allowed"];
  handoff: WorkflowTransition["handoff"];
}

/** Editor launch choices resolve generated model identities into names. */
export interface ScopedWorkflowLaunchBinding extends LaunchBindingInput {
  state_id: State["id"];
  prompt: LaunchBinding["prompt"];
  required_skills: string[];
  stage_skills: LaunchBinding["stage_skills"];
  agent: string | null;
  profile: LaunchBinding["profile"];
  model: string | null;
  reasoning: string | null;
  auto_start: LaunchBinding["auto_start"];
  subtree_run_enabled: LaunchBinding["subtree_run_enabled"];
}

/** Computed validation warning for the assembled workflow. */
export interface WorkflowStandingWarning {
  code: string;
  state_id: State["id"] | null;
  message: string;
}

/** Assembled issue-type editor settings and computed warnings. */
export interface ScopedWorkflowSettings {
  issue_type_id: IssueType["id"];
  start_state_id: IssueType["start_state"];
  workflow_revision: IssueType["workflow_revision"];
  transitions: ScopedWorkflowTransition[];
  launch_bindings: ScopedWorkflowLaunchBinding[];
  warnings: WorkflowStandingWarning[];
}

export type ScopedWorkflowImpactOperation =
  | {
      operation: "remove_state" | "set_start_state";
      state_id: State["id"];
    }
  | {
      operation: "remove_transition";
      from_state_id: State["id"];
      to_state_id: State["id"];
    };

/** Computed preview of edits and their cascaded effects. */
export interface ScopedWorkflowImpact {
  workflow_revision: IssueType["workflow_revision"];
  deleted_transitions: ScopedWorkflowTransition[];
  deleted_launch_bindings: ScopedWorkflowLaunchBinding[];
  disabled_auto_start_state_ids: State["id"][];
}

/** Editor active/draft graph projections with a revision guard. */
export interface IssueTypeWorkflow {
  issue_type_id: IssueType["id"];
  active: WorkflowGraph;
  draft: WorkflowGraph;
  revision: IssueType["workflow_revision"];
}

/** Computed graph/editor diagnostic attached to a domain element. */
export interface WorkflowDiagnostic {
  issue_type_id?: IssueType["id"] | null;
  kind: "node" | "edge" | "type" | "binding";
  node?: State["id"] | null;
  edge?: WorkflowEdge;
  state_id?: State["id"] | null;
  field?: string | null;
  code: string;
  message: string;
}

