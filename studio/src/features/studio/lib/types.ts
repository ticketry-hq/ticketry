// TypeScript mirrors of core/core/models.py

import type { LifecycleState } from "../../agents/terminal";

export interface ModuleLink {
  module_id: string;
  path: string;
}

export interface Profile {
  name: string;
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

export type TaskId = string;
