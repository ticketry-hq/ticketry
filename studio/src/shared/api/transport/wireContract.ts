// Single-source wire contract for the /ws/terminal frames (#692 · T687-3).
//
// This module is the ONLY place a terminal frame is shaped. Every outbound
// frame is produced by a builder here; nothing is constructed inline anywhere
// else. The frame structures mirror the backend's declared models
// (backend/apps/terminals/frames.py), which export the committed
// `wire-frames.schema.json` that the contract test validates these builders'
// output against — so a dropped required field (e.g. the CODIN-685 missing
// `mode`) fails CI rather than reaching production.
//
// Structure only: these builders carry no semantic rules (geometry clamping,
// mutually-exclusive spawn modes, doc-path safety, task-scope requirement) —
// those stay imperative in the backend consumer.

export type AgentKind = "claude" | "agy" | "codex" | "gemini";

/** Parameters for a fresh spawn. An `agent_run_id` is never part of a spawn. */
export interface SpawnParams {
  agent: AgentKind;
  project_id: string;
  module_id: string;
  task_id: string | null;
  initial_prompt: string | null;
  cols: number;
  rows: number;
  is_planning: boolean;
  is_instant: boolean;
  instant_prompt: string | null;
  // #625 doc-agent overlay: a spawn scoped to one generated .html.
  is_doc_chat: boolean;
  doc_rel_path: string | null;
  doc_id: string | null;
}

// The explicit `mode` discriminant (new in #692) is what the backend dispatches
// on. The client used to omit it and let the backend infer spawn-vs-attach from
// `agent_run_id` presence; that implicit coupling is what drifted in #685.

export interface InitSpawnFrame extends SpawnParams {
  type: "init";
  mode: "spawn";
}

export interface InitAttachFrame {
  type: "init";
  mode: "attach";
  agent_run_id: string;
  cols: number;
  rows: number;
}

export interface ResizeFrame {
  type: "resize";
  cols: number;
  rows: number;
}

export interface ScrollFrame {
  type: "scroll";
  dir: "up" | "down";
  lines: number;
}

export interface ReadyFrame {
  type: "ready";
  session_id: string;
  agent_run_id: string | null;
}

export interface ErrorFrame {
  type: "error";
  message: string;
}

/** Build the spawn-mode init frame. */
export function buildSpawnInit(params: SpawnParams): InitSpawnFrame {
  return {
    type: "init",
    mode: "spawn",
    agent: params.agent,
    project_id: params.project_id,
    module_id: params.module_id,
    task_id: params.task_id,
    initial_prompt: params.initial_prompt,
    cols: params.cols,
    rows: params.rows,
    is_planning: params.is_planning,
    is_instant: params.is_instant,
    instant_prompt: params.instant_prompt,
    is_doc_chat: params.is_doc_chat,
    doc_rel_path: params.doc_rel_path,
    doc_id: params.doc_id,
  };
}

/** Build the attach-mode init frame used on first attach and every reconnect. */
export function buildAttachInit(
  agentRunId: string,
  cols: number,
  rows: number,
): InitAttachFrame {
  return { type: "init", mode: "attach", agent_run_id: agentRunId, cols, rows };
}

export function buildResize(cols: number, rows: number): ResizeFrame {
  return { type: "resize", cols, rows };
}

export function buildScroll(dir: "up" | "down", lines: number): ScrollFrame {
  return { type: "scroll", dir, lines };
}

/** Parse an inbound `ready` frame, or null if the shape is wrong. */
export function parseReady(data: unknown): ReadyFrame | null {
  if (!data || typeof data !== "object") return null;
  const f = data as Record<string, unknown>;
  if (f.type !== "ready" || typeof f.session_id !== "string" || !f.session_id) {
    return null;
  }
  return {
    type: "ready",
    session_id: f.session_id,
    agent_run_id: typeof f.agent_run_id === "string" ? f.agent_run_id : null,
  };
}

/** Parse an inbound `error` frame, or null if the shape is wrong. */
export function parseError(data: unknown): ErrorFrame | null {
  if (!data || typeof data !== "object") return null;
  const f = data as Record<string, unknown>;
  if (f.type !== "error") return null;
  return { type: "error", message: typeof f.message === "string" ? f.message : "ws_error" };
}
