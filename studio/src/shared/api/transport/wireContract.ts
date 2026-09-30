/**
 * Single-source wire contract for the `/ws/terminal` frames.
 *
 * This module is the only place a terminal frame is shaped. Every outbound
 * frame is produced by a builder here and every inbound control frame is
 * parsed here, so the browser client cannot drift from the backend's declared
 * attach schema. The socket is attach-only: a durable run is always created
 * through the GraphQL control plane first, then attached.
 *
 * Structure only — these builders carry no semantic rules (geometry clamping,
 * session lookup, pressure limits); those stay in the server consumer.
 */

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
  const frame = data as Record<string, unknown>;
  if (frame.type !== "ready" || typeof frame.session_id !== "string" || !frame.session_id) {
    return null;
  }
  return {
    type: "ready",
    session_id: frame.session_id,
    agent_run_id: typeof frame.agent_run_id === "string" ? frame.agent_run_id : null,
  };
}

/** Parse an inbound `error` frame, or null if the shape is wrong. */
export function parseError(data: unknown): ErrorFrame | null {
  if (!data || typeof data !== "object") return null;
  const frame = data as Record<string, unknown>;
  if (frame.type !== "error") return null;
  return {
    type: "error",
    message: typeof frame.message === "string" ? frame.message : "ws_error",
  };
}
