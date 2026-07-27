/**
 * Platform-neutral terminal transport contract.
 *
 * The control plane creates durable runs; a terminal client only attaches a
 * viewer to one of those runs. Adapters may use WebSocket, Tauri IPC, or a
 * native stream without changing the pooled xterm lifecycle.
 *
 * Event semantics:
 * - `eof` means the remote viewer's output ended. It is distinct from a local
 *   `closed` event, which only says this client/viewer transport ended.
 * - `suspended` / `resumed` describe intentional background detach and
 *   subsequent reattach; neither means the durable run exited.
 * - `reattachment_required` means the adapter cannot restore the viewer. A
 *   caller may keep the tab's scrollback, but must not keep sending input.
 */

export type TerminalClientStatus =
  | "connecting"
  | "ready"
  | "suspended"
  | "reattachment_required"
  | "closed";

/**
 * The layer that failed, kept deliberately separate from an error message so
 * support can tell whether retrying the viewer, fixing tmux, or fixing the
 * renderer is appropriate.
 */
export type TerminalClientFailureLayer =
  | "control_plane"
  | "pty"
  | "tmux_attach"
  | "channel"
  | "renderer"
  | "transport"
  | "protocol"
  | "session";

export type TerminalClientReattachmentReason =
  | "invalid_run_id"
  | "session_not_found"
  | "session_ended"
  | "tmux_unavailable"
  | "pty_failed"
  | "channel_closed"
  | "renderer_failed"
  | "control_plane_failed"
  | "replaced_by_another_viewer"
  | "reconnect_exhausted";

export interface TerminalClientAttachParams {
  agentRunId: string;
  cols: number;
  rows: number;
}

export type TerminalClientEvent =
  | { type: "connecting"; attempt: number }
  | { type: "ready"; sessionId: string; agentRunId: string }
  | { type: "output"; bytes: Uint8Array }
  | { type: "eof" }
  | { type: "error"; layer: TerminalClientFailureLayer; message: string }
  | { type: "suspended" }
  | { type: "resumed" }
  | {
      type: "reattachment_required";
      reason: TerminalClientReattachmentReason;
    }
  | {
      type: "closed";
      reason: "viewer_exit" | "pty_eof" | "client_detach" | "transport_closed" | "channel_closed";
      code: number;
      detail: string;
    };

export interface TerminalClient {
  input(bytes: Uint8Array): void;
  resize(cols: number, rows: number): void;
  scroll(direction: "up" | "down", lines: number): void;
  detach(): void;
  suspend(): boolean;
  resume(): void;
  status(): TerminalClientStatus;
}

export interface TerminalClientTransport {
  attach(params: TerminalClientAttachParams, onEvent: (event: TerminalClientEvent) => void): TerminalClient;
}
