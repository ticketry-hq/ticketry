export interface Project {
  readonly id: string;
  name: string;
  slug: string;
  description?: string;
  readonly manual_module_order: boolean;
}
// `manual_module_order` joins `id` as server-owned: a project's module
// ordering mode is set by the module reorder domain operation, never by a
// create or update body.
export type ProjectCreate = Omit<Project, "id" | "manual_module_order">;
export type ProjectPatch = Partial<Omit<Project, "id" | "manual_module_order">>;
/** A project's identity plus the onboarding state it now owns. */
export interface OnboardingProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly onboarding_required: boolean;
}
export interface LaunchBinding extends LaunchBindingInput {
  id: number;
  issue_type_id: string;
  state_id: string;
  auto_start?: boolean;
  subtree_run_enabled?: boolean;
  workflow_revision: number;
}
export interface LaunchBindingInput {
  prompt?: string | null;
  required_skills?: string[] | null;
  entry_skill?: string | null;
  agent?: string | null;
  model?: string | null;
  reasoning?: string | null;
}
export interface ProviderCapabilities {
  agent: string;
  accepts_model: boolean;
  accepts_any_model: boolean;
  model_aliases?: string[];
  model_prefixes?: string[];
  reasoning_levels?: string[];
  /** Model-specific compatibility from the generated catalogue join rows. */
  model_reasoning_levels?: Record<string, string[]>;
  supports_unattended?: boolean;
}

export interface StateImpact {
  state_id: string;
  total_work_items: number;
  protection_rules?: Array<{ code: string; message: string }>;
}

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

export interface Module {
  readonly id: string;
  name: string;
  readonly project_id: string;
  readonly sequence_id: number;
  readonly key: string;
  readonly is_archived: boolean;
  readonly issue_type: string;
}

export type IssueLevel = "module" | "task";
export interface IssueType {
  id: string;
  project?: string;
  name: string;
  level: IssueLevel;
  color: string | null;
  sort_order: number;
  start_state?: string | null;
  workflow_revision?: number;
}

export interface State {
  id: string | null;
  name: string;
  group: string;
  color: string | null;
  sort_order?: number;
  /** #629 · read-only — server is the sole writer; never sent on create/patch. */
  is_protected?: boolean;
}

export interface WorkItem {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
  readonly sequence_id: number;
  readonly state: string | null;
  readonly description: string;
  readonly parent_id: string | null;
  readonly sub_issues_count: number;
  readonly key: string;
  readonly is_archived: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly rank: string;
  readonly issue_type: string;
  readonly blocked_by_ids: string[];
  readonly blocks_ids: string[];
}

export interface ModuleTree {
  rootIds: string[];
  /** Absent key = children have not been read; [] = known childless. */
  children: Record<string, string[]>;
  /** Canonical server order for deterministic rankless fallbacks. */
  order: string[];
}

export interface Attachment {
  readonly id: string;
  readonly issue: string;
  readonly filename: string;
  mime_type: string;
  size: number | null;
  readonly url: string;
  readonly created_at: string;
}

export interface WorkItemDetail {
  task: WorkItem;
  attachments: Attachment[];
}

export interface WorkItemCreate {
  name: string;
  description?: string | null;
  issue_type_id?: string | null;
  state_id?: string | null;
  parent_id?: string | null;
}
export type ModuleWorkItemCreate = WorkItemCreate;

export interface WorkItemPatch {
  blocked_by_ids?: string[];
  name?: string;
  description?: string | null;
  parent_id?: string | null;
  state_id?: string | null;
  issue_type_id?: string;
}

export interface IssueTypeCreate {
  name: string;
  level: IssueLevel;
  color?: string | null;
}
export interface IssueTypePatch {
  name?: string;
  level?: IssueLevel;
  color?: string | null;
  sort_order?: number;
  start_state?: string | null;
  workflow_revision?: number;
}
export interface StateCreate {
  name: string;
  group: string;
  color?: string | null;
}
export interface StatePatch {
  name?: string;
  color?: string | null;
  group?: string;
  sort_order?: number;
}

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
  entry_skill: string | null;
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
}

export type View = "backlog" | "settings";
