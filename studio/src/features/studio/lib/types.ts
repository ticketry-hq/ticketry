// TypeScript mirrors of core/core/models.py

import type { LifecycleState } from "../../agents/terminal";
import type { IssueTypeOut } from "@worktracker/typescript-sdk/models";

export interface ModuleLink {
  module_id: string;
  path: string;
}

export interface Profile {
  name: string;
  workspace_slug: string;
  agent_prompt: string | null;
  agent_prompts: Record<string, string>;
  module_links: ModuleLink[];
  recent_project_id?: string | null;
  recent_module_ids?: Record<string, string>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  identifier: string;
}

export interface ModuleSummary {
  id: string;
  name: string;
  project_id: string;
  // Most recent agent interaction (ISO-8601), merged client-side from the
  // runs activity map for recency sorting (#598). Absent if never touched.
  last_activity?: string;
}

export interface TaskState {
  id: string | null;
  name: string;
  group: string;
  color: string | null;
  // Canonical workflow position (CODIN-859); primary ordering key over group.
  sort_order?: number;
}

export interface TaskSummary {
  id: string;
  name: string;
  project_id: string;
  sequence_id: number | null;
  // Server-computed canonical ticket key. Optional for older cached summaries
  // and synthetic rows such as Scratch.
  key?: string;
  // Canonical fractional rank. Optional for older cached summaries and
  // synthetic rows such as Scratch.
  rank?: string;
  state: TaskState;
  // Every persisted or synthetic task summary carries an explicit type.
  issue_type: IssueTypeOut;
  description: string | null;
  parent_id: string | null;
  sub_issues_count: number;
  // Project-monotonic workflow-state revision (CODIN-1102). Ordering guard for
  // status-feed state deltas; absent on synthetic rows (scratch task).
  state_revision?: number;
  // Authoritative write timestamp. Rank-only reorders do not advance the
  // workflow-state revision, so this is the concurrency guard for rank races.
  updated_at?: string;
}

export interface TaskDetails {
  task: TaskSummary;
}

// Per-task worktree and terminal types live in features/agents.

export interface RunningAgentCount {
  direct: number;
  descendant: number;
  total: number;
}

export interface RunningAgentCountsPayload {
  counts: Record<string, RunningAgentCount>;
  // Running-agent lifecycle states per task id, then per agent_run_id (#512),
  // so headless runs surface attention and the relay can patch a single run.
  states: Record<string, Record<string, LifecycleState>>;
  // Full module parent -> child task-id topology, so collapsed-parent rollups
  // walk the entire subtree instead of only lazily-loaded branches (#516).
  children: Record<string, string[]>;
}

export type AgentName = "claude" | "agy" | "codex" | "gemini";

export interface ConfigPayload {
  recent_profile_index: number | null;
  profiles: Profile[];
  features: {
    sidebar: boolean;
    projects: boolean;
  };
}

export type TaskId = string;
export type SessionId = string;

// ---------- Per-ticket workspace (ticket #493) ----------

// Which kind of content the right pane shows for a ticket. Terminal selection
// also tracks *which* terminal via the shared workspace-tabs store.
export type TabKind = "details" | "doc" | "terminal";

// A dormant record of a closed terminal run, shown as an inert chip in the
// strip (D5). Inert in this ticket; a `--continue`-style resume is a follow-up.
export interface RunChip {
  agentRunId: string | null;
  agent: string;
  label: string;
}

// ---------- Generated design documents (ticket #521) ----------

// One registered agent-generated design document, as listed by
// GET /api/documents and carried in `document` frames.
export interface DesignDoc {
  id: string;
  rel_path: string;
  label: string;
}

// Per-workspace document tab state. `reloadToken` refreshes the renderer;
// `open: false` demotes the tab to a reopen chip.
export interface DocTabState {
  docId: string;
  relPath: string;
  label: string;
  open: boolean;
  reloadToken: number;
}
