import type {
  Attachment as GeneratedAttachment,
  Module as GeneratedModule,
  Project as GeneratedProject,
  PatchedProject as GeneratedProjectPatch,
  WorkItem as GeneratedWorkItem,
  WorkItemCreate as GeneratedWorkItemCreate,
  PatchedWorkItemPatch as GeneratedWorkItemPatch,
  Workspace as GeneratedWorkspace,
} from "@worktracker/typescript-sdk";

export type Project = GeneratedProject;
// `manual_module_order` joins `id` as server-owned: a project's module
// ordering mode is set by the module reorder domain operation, never by a
// create or update body.
export type ProjectCreate = Omit<GeneratedProject, "id" | "manual_module_order">;
export type ProjectPatch = GeneratedProjectPatch;
export type Workspace = GeneratedWorkspace;
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

export type Module = GeneratedModule;

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

export type WorkItem = GeneratedWorkItem;

export interface ModuleTree {
  rootIds: string[];
  /** Absent key = children have not been read; [] = known childless. */
  children: Record<string, string[]>;
  /** Canonical server order for deterministic rankless fallbacks. */
  order: string[];
}

export type Attachment = Omit<
  GeneratedAttachment,
  "mime_type" | "size"
> & {
  mime_type: string;
  size: number | null;
};

export interface WorkItemDetail {
  task: WorkItem;
  attachments: Attachment[];
}

export type WorkItemCreate = GeneratedWorkItemCreate;
export type ModuleWorkItemCreate = GeneratedWorkItemCreate;

export type WorkItemPatch = Omit<
  GeneratedWorkItemPatch,
  "blocked_by_ids" | "name" | "origin"
> & {
  blocked_by_ids?: string[];
  name?: string;
  issue_type_id?: string;
};

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
