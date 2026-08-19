import { buildAttachInit, buildResize, buildScroll, parseError, parseReady } from "../../../../shared/api/transport/wireContract";
import { terminalWebSocketUrl } from "../../../../runtime";
import type {
  TerminalClient,
  TerminalClientAttachParams,
  TerminalClientEvent,
  TerminalClientStatus,
  TerminalClientTransport,
} from "./terminalClient";

const RECONNECT_BASE_MS = 500;
const RECONNECT_FACTOR = 2;
const RECONNECT_CAP_MS = 10_000;
const RECONNECT_MAX_ATTEMPTS = 8;

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
  let currentWs: WebSocket;
  let cols = params.cols;
  let rows = params.rows;
  let attempt = 0;
  let everReady = false;
  let detached = false;
  let sessionLost = false;
  let sessionEnded = false;
  let viewerReplaced = false;
  let suspended = false;
  let state: TerminalClientStatus = "connecting";
  let timer: ReturnType<typeof setTimeout> | null = null;

  function backoffDelay(n: number): number {
    const base = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * RECONNECT_FACTOR ** n);
    return base + Math.random() * base * 0.25;
  }

  function connect(isResume = false): void {
    state = "connecting";
    onEvent({ type: "connecting", attempt });
    const ws = new WebSocket(terminalWebSocketUrl());
    ws.binaryType = "arraybuffer";
    currentWs = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(buildAttachInit(params.agentRunId, cols, rows)));
    };
    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        onEvent({ type: "output", bytes: new Uint8Array(event.data) });
        return;
      }
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
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
        if (isResume) onEvent({ type: "resumed" });
        return;
      }
      const error = parseError(parsed);
      if (error) {
        if (error.message === "session_not_found") sessionLost = true;
        if (error.message === "session_ended") sessionEnded = true;
        if (error.message === "replaced_by_another_viewer") viewerReplaced = true;
        onEvent({
          type: "error",
          layer:
            error.message === "session_not_found" || error.message === "session_ended"
              ? "session"
              : "protocol",
          message: error.message,
        });
      }
    };
    ws.onclose = (event: CloseEvent) => {
      if (suspended && !detached) return;
      if (detached) {
        state = "closed";
        onEvent({ type: "closed", reason: "client_detach", code: event.code, detail: event.reason });
        return;
      }
      if (sessionLost) {
        state = "reattachment_required";
        onEvent({ type: "reattachment_required", reason: "session_not_found" });
        return;
      }
      if (sessionEnded) {
        state = "reattachment_required";
        onEvent({ type: "reattachment_required", reason: "session_ended" });
        return;
      }
      if (viewerReplaced) {
        state = "reattachment_required";
        onEvent({ type: "reattachment_required", reason: "replaced_by_another_viewer" });
        return;
      }
      if (event.code === 1000) {
        state = "closed";
        onEvent({ type: "eof" });
        onEvent({ type: "closed", reason: "viewer_exit", code: event.code, detail: event.reason });
        return;
      }
      if (everReady && attempt < RECONNECT_MAX_ATTEMPTS) {
        attempt += 1;
        timer = setTimeout(() => connect(), backoffDelay(attempt - 1));
        return;
      }
      if (everReady) {
        state = "reattachment_required";
        onEvent({ type: "reattachment_required", reason: "reconnect_exhausted" });
        return;
      }
      state = "closed";
      onEvent({ type: "closed", reason: "transport_closed", code: event.code, detail: event.reason });
    };
    ws.onerror = () => {};
  }

  const client: TerminalClient = {
    input(bytes) {
      currentWs.send(bytes.buffer as ArrayBuffer);
    },
    resize(nextCols, nextRows) {
      cols = nextCols;
      rows = nextRows;
      if (currentWs.readyState === WebSocket.OPEN) currentWs.send(JSON.stringify(buildResize(cols, rows)));
    },
    scroll(direction, lines) {
      if (currentWs.readyState === WebSocket.OPEN) currentWs.send(JSON.stringify(buildScroll(direction, lines)));
    },
    detach() {
      detached = true;
      if (timer) clearTimeout(timer);
      currentWs.close(1000, "client_detach");
    },
    suspend() {
      if (!everReady || detached || suspended) return false;
      suspended = true;
      if (timer) clearTimeout(timer);
      attempt = 0;
      state = "suspended";
      currentWs.close(1000, "suspend");
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
