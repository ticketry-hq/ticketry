import type {
  AssigneeOut as GeneratedAssignee,
  AttachmentOut as GeneratedAttachment,
  IssueTypeIn as GeneratedIssueTypeCreate,
  IssueTypeOut as GeneratedIssueType,
  IssueTypePatch as GeneratedIssueTypePatch,
  LabelOut as GeneratedLabel,
  LaunchBindingOut as GeneratedLaunchBinding,
  ModuleOut as GeneratedModule,
  ModuleWorkItemIn as GeneratedModuleWorkItemCreate,
  ProjectIn as GeneratedProjectCreate,
  ProjectOut as GeneratedProject,
  ProjectPatch as GeneratedProjectPatch,
  ProviderCapabilitiesOut as GeneratedProviderCapabilities,
  ScopeContextOut as GeneratedScopeContext,
  ScopeRef as GeneratedScopeRef,
  StateIn as GeneratedStateCreate,
  StateOut as GeneratedState,
  StatePatch as GeneratedStatePatch,
  WorkItemDetailOut as GeneratedWorkItemDetail,
  WorkItemIn as GeneratedWorkItemCreate,
  WorkItemOut as GeneratedWorkItem,
  WorkItemPatch as GeneratedWorkItemPatch,
  WorkspaceOut as GeneratedWorkspace,
} from "@worktracker/typescript-sdk";

export type Project = GeneratedProject;
export type ProjectCreate = GeneratedProjectCreate;
export type ProjectPatch = GeneratedProjectPatch;
export type Workspace = GeneratedWorkspace;
export type LaunchBinding = GeneratedLaunchBinding;
export interface LaunchBindingInput {
  prompt?: string | null;
  required_skills?: string[] | null;
  agent?: string | null;
  model?: string | null;
  reasoning?: string | null;
}
export type ProviderCapabilities = GeneratedProviderCapabilities;

// Host-wide provider activation plus the single global launch default
// (ADR-0015). The `agy` adapter stays in code but is not configurable here.
export type ConfigurableProvider = "claude" | "codex" | "gemini";
export interface GlobalLaunchDefault {
  provider: ConfigurableProvider;
  model: string | null;
  reasoning: string | null;
}
export interface ProviderCatalog {
  activated_providers: ConfigurableProvider[];
  global_default: GlobalLaunchDefault | null;
}
export type SubtreeRunCapabilityMap = Record<string, string[]>;

export type Module = GeneratedModule;

export type IssueLevel = "module" | "task";
export type IssueType = Omit<
  GeneratedIssueType,
  "level" | "name" | "color" | "icon" | "sort_order" | "is_default"
> & {
  name: string;
  level: IssueLevel;
  color: string | null;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
};

export type State = Omit<
  GeneratedState,
  "id" | "name" | "group" | "color" | "sort_order"
> & {
  id: string | null;
  name: string;
  group: string;
  color: string | null;
  sort_order?: number;
  /** #629 · read-only — server is the sole writer; never sent on create/patch. */
  is_protected?: boolean;
};

export type LifecycleState =
  | "backlog"
  | "refining"
  | "prd_generated"
  | "prd_review"
  | "prd_approved"
  | "generating_hld"
  | "hld_generated"
  | "hld_review"
  | "hld_approved"
  | "registering_split"
  | "split_created"
  | "lld_generating"
  | "lld_generated"
  | "lld_review"
  | "lld_approved"
  | "implementing"
  | "done"
  | "failed"
  | "cancelled";

export type Assignee = GeneratedAssignee;
export type Label = GeneratedLabel;

export type WorkItem = Omit<
  GeneratedWorkItem,
  | "assignees"
  | "blocked_by_ids"
  | "blocks_ids"
  | "description"
  | "description_html"
  | "description_stripped"
  | "is_archived"
  | "labels"
  | "parent_id"
  | "rank"
  | "sequence_id"
  | "state"
  | "lifecycle_state"
  | "lifecycle_transitions"
  | "sub_issues_count"
> & {
  sequence_id: number | null;
  state: State | null;
  lifecycle_state?: LifecycleState | null;
  lifecycle_transitions?: LifecycleState[];
  assignees: Assignee[];
  labels: Label[];
  description_html: string | null;
  description_stripped: string | null;
  description: string | null;
  parent_id: string | null;
  sub_issues_count: number;
  is_archived?: boolean;
  rank?: string;
  blocked_by_ids: string[];
  blocks_ids: string[];
};

export type Attachment = Omit<
  GeneratedAttachment,
  "mime_type" | "size"
> & {
  mime_type: string;
  size: number | null;
};

export type WorkItemDetail = Omit<
  GeneratedWorkItemDetail,
  "task" | "attachments"
> & {
  task: WorkItem;
  attachments: Attachment[];
};

export type WorkItemCreate = GeneratedWorkItemCreate;
export type ModuleWorkItemCreate = GeneratedModuleWorkItemCreate;

// Agent scope-context payload (#667 B). Read-only; consumed by agents, not the
// graph view (which derives from already-loaded items). Tightens the generated
// shape so required fields are non-optional.
export type ScopeRef = Omit<
  GeneratedScopeRef,
  "state_group" | "resolved" | "assignees"
> & {
  state_group: string | null;
  resolved: boolean;
  assignees: string[];
};

export type ScopeContext = Omit<
  GeneratedScopeContext,
  "task" | "depends_on" | "depended_by" | "owned_elsewhere" | "advisory"
> & {
  task: ScopeRef;
  depends_on: ScopeRef[];
  depended_by: ScopeRef[];
  owned_elsewhere: ScopeRef[];
  advisory: string;
};

export type WorkItemPatch = Omit<
  GeneratedWorkItemPatch,
  "blocked_by_ids" | "labels" | "name" | "origin"
> & {
  blocked_by_ids?: string[];
  labels?: string[];
  name?: string;
  force?: boolean;
};

export type IssueTypeCreate = Omit<
  GeneratedIssueTypeCreate,
  "level"
> & {
  level: IssueLevel;
};
export type IssueTypePatch = Omit<
  GeneratedIssueTypePatch,
  "name" | "color" | "icon" | "is_default" | "sort_order"
> & {
  name?: string;
  color?: string;
  icon?: string;
  is_default?: boolean;
  sort_order?: number;
};
export type StateCreate = GeneratedStateCreate;
export type StatePatch = Omit<
  GeneratedStatePatch,
  "name" | "color" | "group" | "sort_order"
> & {
  name?: string;
  color?: string;
  group?: string;
  sort_order?: number;
};

export interface WorkflowEdge {
  from: string;
  to: string;
  auto_launch?: boolean;
}

export interface WorkflowGraph {
  start_state_id: string | null;
  terminal_state_ids: string[];
  edges: WorkflowEdge[];
}

export interface ScopedWorkflowTransition {
  from_state_id: string;
  to_state_id: string;
  agent_allowed: boolean;
}

export interface ScopedWorkflowLaunchBinding extends LaunchBindingInput {
  state_id: string;
  prompt: string;
  required_skills: string[];
  agent: string | null;
  model: string | null;
  reasoning: string | null;
  auto_start: boolean;
  subtree_run_enabled: boolean;
}

export interface WorkflowStandingWarning {
  code: string;
  state_id: string | null;
  message: string;
}

export interface ScopedWorkflowSettings {
  issue_type_id: string;
  start_state_id: string | null;
  workflow_revision: number;
  transitions: ScopedWorkflowTransition[];
  launch_bindings: ScopedWorkflowLaunchBinding[];
  warnings: WorkflowStandingWarning[];
}

export type ScopedWorkflowImpactOperation =
  | {
      operation: "remove_state" | "set_start_state";
      state_id: string;
    }
  | {
      operation: "remove_transition";
      from_state_id: string;
      to_state_id: string;
    };

export interface ScopedWorkflowImpact {
  workflow_revision: number;
  deleted_transitions: ScopedWorkflowTransition[];
  deleted_launch_bindings: ScopedWorkflowLaunchBinding[];
  disabled_auto_start_state_ids: string[];
}

export interface IssueTypeWorkflow {
  issue_type_id: string;
  active: WorkflowGraph;
  draft: WorkflowGraph;
  revision: number;
}

export interface WorkflowDiagnostic {
  issue_type_id?: string | null;
  kind: "node" | "edge" | "type" | "binding";
  node?: string | null;
  edge?: WorkflowEdge;
  state_id?: string | null;
  field?: string | null;
  code: string;
  message: string;
}

export interface WorkItemFilters {
  parent?: string;
  state?: string;
  includePathfind?: boolean;
}

export type View = "backlog" | "settings";
