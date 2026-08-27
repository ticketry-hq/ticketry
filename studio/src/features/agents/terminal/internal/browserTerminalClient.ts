import {
  buildAttachInit,
  buildResize,
  buildScroll,
  parseError,
  parseReady,
} from "../../../../shared/api/transport/wireContract";
import { terminalWebSocketUrl } from "../../../../runtime";
import type {
  TerminalClient,
  TerminalClientAttachParams,
  TerminalClientEvent,
  TerminalClientFailureLayer,
  TerminalClientStatus,
  TerminalClientTransport,
} from "./terminalClient";

// Bounded reconnect for transient drops after a live attach: ~45s total
// budget (0.5+1+2+4+8+10+10+10s plus jitter) with 25% jitter to avoid
// synchronized reconnect storms. A fresh ready frame resets the attempt.
const RECONNECT_BASE_MS = 500;
const RECONNECT_FACTOR = 2;
const RECONNECT_CAP_MS = 10_000;
const RECONNECT_MAX_ATTEMPTS = 8;

function backoffDelay(attempt: number): number {
  const base = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * RECONNECT_FACTOR ** attempt);
  return base + Math.random() * base * 0.25;
}

/**
 * Coerce an inbound binary frame to an exact Uint8Array over its own bytes,
 * without relying on cross-realm `instanceof` checks.
 */
function toOutputBytes(data: unknown): Uint8Array | null {
  if (typeof data !== "object" || data === null) return null;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  const byteLength = (data as { byteLength?: unknown }).byteLength;
  return typeof byteLength === "number"
    ? new Uint8Array(data as ArrayBuffer)
    : null;
}

/** Browser WebSocket implementation of the platform-neutral terminal client. */
export const browserTerminalClient: TerminalClientTransport = {
  attach(params, onEvent) {
    return openBrowserTerminalClient(params, onEvent);
  },
};

export function openBrowserTerminalClient(
  params: TerminalClientAttachParams,
  onEvent: (event: TerminalClientEvent) => void,
): TerminalClient {
  let socket: WebSocket | null = null;
  // Latest geometry, kept current via resize() so every reconnect init — and
  // the very first one, if resize fires before the socket opens — carries it.
  let cols = params.cols;
  let rows = params.rows;
  let attempt = 0;
  let everReady = false;
  let detached = false;
  let suspended = false;
  let sessionLost = false;
  let viewerReplaced = false;
  let resumePending = false;
  let state: TerminalClientStatus = "connecting";
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function clearReconnect(): void {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  /** Defensive socket-state check: a stale xterm callback must not throw. */
  function sendText(frame: object): void {
    if (!socket || socket.readyState !== WebSocket.OPEN || detached || suspended) return;
    socket.send(JSON.stringify(frame));
  }

  function sendInput(bytes: Uint8Array): void {
    if (!socket || socket.readyState !== WebSocket.OPEN || detached || suspended) return;
    socket.send(bytes);
  }

  function connect(isResume = false): void {
    clearReconnect();
    resumePending = isResume;
    state = "connecting";
    onEvent({ type: "connecting", attempt });
    const ws = new WebSocket(terminalWebSocketUrl());
    ws.binaryType = "arraybuffer";
    socket = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(buildAttachInit(params.agentRunId, cols, rows)));
    };
    ws.onmessage = (event: MessageEvent<unknown>) => {
      if (detached || suspended || socket !== ws) return;
      const data = event.data;
      if (typeof data === "string") {
        handleMessageText(data);
        return;
      }
      const bytes = toOutputBytes(data);
      if (bytes) onEvent({ type: "output", bytes });
    };
    ws.onclose = (event: CloseEvent) => {
      if (socket !== ws) return;
      socket = null;
      handleClose(event.code, event.reason);
    };
    // Transport errors always precede an onclose; let the close code drive
    // retry-vs-terminal rather than surfacing a premature error.
    ws.onerror = () => {};
  }

  function handleMessageText(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      onEvent({ type: "error", layer: "protocol", message: "bad_json" });
      return;
    }
    const ready = parseReady(parsed);
    if (ready) {
      attempt = 0;
      everReady = true;
      state = "ready";
      onEvent({
        type: "ready",
        sessionId: ready.session_id,
        agentRunId: ready.agent_run_id ?? params.agentRunId,
      });
      if (resumePending) {
        resumePending = false;
        onEvent({ type: "resumed" });
      }
      return;
    }
    const error = parseError(parsed);
    if (error) {
      if (error.message === "session_not_found") sessionLost = true;
      if (error.message === "replaced_by_another_viewer") viewerReplaced = true;
      const layer: TerminalClientFailureLayer =
        error.message === "session_not_found" ? "session" : "protocol";
      onEvent({ type: "error", layer, message: error.message });
      return;
    }
    onEvent({ type: "error", layer: "protocol", message: "unknown_frame" });
  }

  function handleClose(code: number, reason: string): void {
    clearReconnect();
    // Suspend- and detach-initiated closes are cleanup, not lifecycle events:
    // suspend() already emitted `suspended`, detach() emits its own closed.
    if (detached || suspended) return;
    if (sessionLost) {
      state = "reattachment_required";
      onEvent({ type: "reattachment_required", reason: "session_not_found" });
      return;
    }
    if (viewerReplaced) {
      state = "reattachment_required";
      onEvent({ type: "reattachment_required", reason: "replaced_by_another_viewer" });
      return;
    }
    if (code === 1000 && everReady) {
      state = "closed";
      onEvent({ type: "eof" });
      onEvent({ type: "closed", reason: "viewer_exit", code, detail: reason });
      return;
    }
    if (everReady && attempt < RECONNECT_MAX_ATTEMPTS) {
      attempt += 1;
      reconnectTimer = setTimeout(() => connect(), backoffDelay(attempt - 1));
      return;
    }
    if (everReady) {
      state = "reattachment_required";
      onEvent({ type: "error", layer: "channel", message: "reconnect_exhausted" });
      onEvent({ type: "reattachment_required", reason: "reconnect_exhausted" });
      return;
    }
    state = "closed";
    onEvent({ type: "closed", reason: "transport_closed", code, detail: reason });
  }

  const client: TerminalClient = {
    input(bytes) {
      sendInput(bytes);
    },
    resize(nextCols, nextRows) {
      cols = nextCols;
      rows = nextRows;
      sendText(buildResize(cols, rows));
    },
    scroll(direction, lines) {
      sendText(buildScroll(direction, lines));
    },
    detach() {
      if (detached) return;
      detached = true;
      clearReconnect();
      state = "closed";
      const current = socket;
      socket = null;
      if (current && current.readyState !== WebSocket.CLOSED) {
        current.close(1000, "client_detach");
      }
      onEvent({ type: "closed", reason: "client_detach", code: 1000, detail: "client_detach" });
    },
    suspend() {
      // Only a live, re-attachable transport may drop: without a ready frame
      // there is nothing for resume() to reattach to.
      if (!everReady || detached || suspended) return false;
      suspended = true;
      resumePending = false;
      clearReconnect();
      attempt = 0;
      state = "suspended";
      const current = socket;
      socket = null;
      if (current && current.readyState !== WebSocket.CLOSED) {
        current.close(1000, "suspend");
      }
      onEvent({ type: "suspended" });
      return true;
    },
    resume() {
      if (!suspended || detached) return;
      suspended = false;
      connect(true);
    },
    status() {
      return state;
    },
  };

  connect();
  return client;
}
