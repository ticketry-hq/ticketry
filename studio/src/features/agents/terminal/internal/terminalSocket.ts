// WebSocket client for /ws/terminal (#692 · T687-3).
//
// The reconnect/backoff schedule
// and the binary-bytes-vs-JSON-control routing are preserved verbatim; the only
// change is that every outbound frame is now produced by a wireContract builder
// instead of an inline object literal, so the client emits the explicit `mode`
// discriminant and can no longer drift from the backend's declared schema.

import {
  buildAttachInit,
  buildResize,
  buildScroll,
  buildSpawnInit,
  parseError,
  parseReady,
  type AgentKind,
} from "../../../../shared/api/transport/wireContract";
import { terminalWebSocketUrl } from "../../../../runtime";

// Compatibility export while callers migrate from this historical module name.
// The production runtime selects this contract adapter, never `openTerminalSocket`.
export { browserTerminalClient } from "./browserTerminalClient";

export interface TerminalSocketParams {
  agent: AgentKind;
  project_id: string;
  module_id: string;
  task_id: string | null;
  initial_prompt: string | null;
  cols: number;
  rows: number;
  is_planning?: boolean;
  is_instant?: boolean;
  instant_prompt?: string | null;
  // #625 doc-agent overlay: spawn a fresh agent scoped to one generated .html.
  // The backend launches it in the doc's design directory and seeds a prompt
  // pointed at `doc_rel_path`. Spawn-branch only; ignored on attach.
  is_doc_chat?: boolean;
  doc_rel_path?: string | null;
  doc_id?: string | null;
  // When set, the socket reattaches to an existing persisted tmux session
  // instead of spawning a new agent. The backend's attach branch only reads
  // agent_run_id/cols/rows, so the spawn-only fields above are ignored.
  agent_run_id?: string | null;
}

export interface TerminalSocketCallbacks {
  onBytes?: (bytes: Uint8Array) => void;
  onReady?: (sessionId: string, agentRunId: string | null) => void;
  onError?: (message: string) => void;
  // The backend confirmed that the durable attach target no longer exists.
  onSessionLost?: () => void;
  onClose?: (code: number, reason: string) => void;
  onOpen?: () => void;
  // A previously-ready socket dropped on transport (non-1000) and a reconnect
  // attempt was scheduled. `attempt` is 1-based.
  onReconnecting?: (attempt: number) => void;
  // A scheduled reconnect re-attached successfully (its `ready` frame arrived).
  onReconnected?: () => void;
  // The reconnect budget was exhausted; the caller should mark the tab exited.
  onReconnectFailed?: (code: number) => void;
}

export interface TerminalSocketHandle {
  ws: WebSocket;
  send: (bytes: Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  scroll: (dir: "up" | "down", lines: number) => void;
  close: () => void;
  // Deliberately drop the transport while the session is backgrounded. Only a
  // socket that has reached `ready` with a known agent_run_id can suspend —
  // anything else has no re-attach target — so this returns whether it did.
  suspend: () => boolean;
  // Re-open a suspended transport via the attach branch, keeping the caller's
  // session identity (fires onReconnected, never a second onReady).
  resume: () => void;
  isSuspended: () => boolean;
}

// Backoff schedule for transient-drop reconnects. The total budget
// (~0.5+1+2+4+8+10+10+10 ≈ 45s, plus jitter) is chosen to outlast the
// backend's tmux-viewer release window so a 4409 against the user's own
// lingering reservation can eventually succeed (LLD decision 2).
const RECONNECT_BASE_MS = 500;
const RECONNECT_FACTOR = 2;
const RECONNECT_CAP_MS = 10_000;
const RECONNECT_MAX_ATTEMPTS = 8;

/**
 * Open a terminal websocket, transparently reconnecting on transient drops.
 *
 * The returned handle is stable across reconnects: its send/resize/close
 * always target the current underlying socket, which is swapped internally
 * when a dropped connection is re-established. Reconnect only engages for a
 * socket that has already reached `ready` (so a clean agent exit or a
 * spawn/mount-attach rejection never retries) and only while an
 * `agent_run_id` is known to rebuild the attach-mode init frame.
 *
 * :param params: connection parameters; an `agent_run_id` selects attach mode.
 * :param callbacks: lifecycle callbacks (bytes, ready, error, close, reconnect).
 * :return: a stable handle for sending input, resizing, and closing.
 */
export function openTerminalSocket(
  params: TerminalSocketParams,
  callbacks: TerminalSocketCallbacks,
): TerminalSocketHandle {
  let currentWs: WebSocket;
  // Stable durable identity for reconnects; learned from the ready frame on a
  // spawn, supplied up front on an attach.
  let agentRunId = params.agent_run_id ?? null;
  // Latest geometry, kept current via resize() so reconnects re-attach at size.
  let cols = params.cols;
  let rows = params.rows;
  let attempt = 0;
  let everReady = false;
  let closedByUser = false;
  let sessionLost = false;
  // Backgrounded-on-purpose: the pool closed the socket to stop streaming a
  // terminal nobody is viewing. The close is swallowed (no onClose, no retry)
  // and resume() re-attaches through the normal reconnect path.
  let suspended = false;
  // The attach target is gone for good (`session_not_found` error frame). The
  // following close must be terminal — retrying an attach to a dead session
  // would just burn the whole reconnect budget before reporting the loss.
  let timer: ReturnType<typeof setTimeout> | null = null;

  function buildInitFrame() {
    // Once an agent_run_id is known (attach, or a spawn that became ready) the
    // backend's attach branch is the only safe reconnect target.
    return agentRunId
      ? buildAttachInit(agentRunId, cols, rows)
      : buildSpawnInit({
          agent: params.agent,
          project_id: params.project_id,
          module_id: params.module_id,
          task_id: params.task_id,
          initial_prompt: params.initial_prompt,
          cols,
          rows,
          is_planning: params.is_planning ?? false,
          is_instant: params.is_instant ?? false,
          instant_prompt: params.instant_prompt ?? null,
          is_doc_chat: params.is_doc_chat ?? false,
          doc_rel_path: params.doc_rel_path ?? null,
          doc_id: params.doc_id ?? null,
        });
  }

  function backoffDelay(n: number): number {
    const base = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * RECONNECT_FACTOR ** n);

    // Add up-to-25% jitter to avoid synchronized reconnect storms.
    return base + Math.random() * base * 0.25;
  }

  function connect() {
    const ws = new WebSocket(terminalWebSocketUrl());
    ws.binaryType = "arraybuffer";
    currentWs = ws;
    handle.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(buildInitFrame()));
      callbacks.onOpen?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) {
        callbacks.onBytes?.(new Uint8Array(data));
        return;
      }
      if (typeof data === "string") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          callbacks.onError?.("bad_json");
          return;
        }
        const ready = parseReady(parsed);
        if (ready) {
          if (everReady) {
            // A reconnect re-attached; keep the caller's existing session
            // identity (the attach gets a fresh server session_id each time).
            attempt = 0;
            callbacks.onReconnected?.();
          } else {
            everReady = true;
            agentRunId = ready.agent_run_id ?? agentRunId;
            callbacks.onReady?.(ready.session_id, ready.agent_run_id);
          }
          return;
        }
        const err = parseError(parsed);
        if (err) {
          if (err.message === "session_not_found" && agentRunId) {
            sessionLost = true;
          }
          callbacks.onError?.(err.message);
        }
      }
    };

    ws.onclose = (event: CloseEvent) => {
      // A suspend-initiated close is not a lifecycle event: the tab stays
      // `ready` (no onClose → no setExited) and nothing retries until resume().
      if (suspended && !closedByUser) return;
      // User-initiated and clean (1000) closes are terminal: never retry.
      if (closedByUser || event.code === 1000) {
        callbacks.onClose?.(event.code, event.reason);
        return;
      }
      if (sessionLost) {
        callbacks.onSessionLost?.();
        return;
      }
      // A socket that never became ready (spawn error, mount-attach 4409/1008)
      // is terminal; only an already-live tab retries a transport drop.
      if (everReady && agentRunId && attempt < RECONNECT_MAX_ATTEMPTS) {
        attempt += 1;
        callbacks.onReconnecting?.(attempt);
        timer = setTimeout(connect, backoffDelay(attempt - 1));
        return;
      }
      // Budget exhausted (was live) or non-retryable terminal close.
      if (everReady && agentRunId) {
        callbacks.onReconnectFailed?.(event.code);
      } else {
        callbacks.onClose?.(event.code, event.reason);
      }
    };

    // Transport errors always precede an onclose; let close codes drive the
    // retry-vs-terminal decision rather than surfacing a premature error.
    ws.onerror = () => {};
  }

  const handle: TerminalSocketHandle = {
    ws: undefined as unknown as WebSocket,
    send(bytes: Uint8Array) {
      currentWs.send(bytes.buffer as ArrayBuffer);
    },
    resize(c: number, r: number) {
      // Always record the latest geometry so reconnects — and the very first
      // init frame, if this fires before the socket finishes opening — carry
      // it. Only emit a live resize frame on an open socket; sending while
      // CONNECTING throws, which would otherwise drop a corrective fit.
      cols = c;
      rows = r;
      if (currentWs.readyState !== WebSocket.OPEN) return;
      currentWs.send(JSON.stringify(buildResize(c, r)));
    },
    scroll(dir: "up" | "down", lines: number) {
      if (currentWs.readyState !== WebSocket.OPEN) return;
      currentWs.send(JSON.stringify(buildScroll(dir, lines)));
    },
    close() {
      closedByUser = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      currentWs.close(1000, "client_close");
    },
    suspend() {
      // Only a live, re-attachable session may drop its transport: without a
      // ready + agent_run_id there is nothing for resume() to attach to.
      if (!everReady || !agentRunId || closedByUser || suspended) return false;
      suspended = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      attempt = 0;
      currentWs.close(1000, "suspend");
      return true;
    },
    resume() {
      if (!suspended || closedByUser) return;
      suspended = false;
      connect();
    },
    isSuspended() {
      return suspended;
    },
  };

  connect();
  return handle;
}
