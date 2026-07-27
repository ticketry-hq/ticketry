import { Channel, invoke } from "@tauri-apps/api/core";
import { desktopViewerLease, type ViewerLeaseClient, viewerLeaseId } from "./viewerLease";

import type {
  TerminalClient,
  TerminalClientAttachParams,
  TerminalClientEvent,
  TerminalClientFailureLayer,
  TerminalClientReattachmentReason,
  TerminalClientStatus,
  TerminalClientTransport,
} from "./terminalClient";

type ViewerChannelEvent =
  | { type: "output"; data: number[] }
  | { type: "failure"; layer: TerminalClientFailureLayer; code: string; message: string }
  | { type: "closed"; reason: { kind: "detached" | "pty_eof" | "tmux_client_exited" | "channel_closed"; exit_code?: number } };

interface ViewerCommandError {
  code?: string;
  layer?: TerminalClientFailureLayer;
  message?: string;
}

interface ViewerStatus {
  viewerHandle: string;
  runId: string;
  lifecycle: "attached" | "detaching" | "closed";
}

export interface TauriViewerBridge {
  attach(
    params: TerminalClientAttachParams,
    onChannelEvent: (event: ViewerChannelEvent) => void,
  ): Promise<ViewerStatus>;
  input(viewerHandle: string, data: number[]): Promise<void>;
  resize(viewerHandle: string, columns: number, rows: number): Promise<void>;
  scroll(viewerHandle: string, direction: "up" | "down", lines: number): Promise<void>;
  detach(viewerHandle: string): Promise<ViewerStatus>;
}

const tauriViewerBridge: TauriViewerBridge = {
  attach(params, onChannelEvent) {
    const output = new Channel<ViewerChannelEvent>();
    output.onmessage = onChannelEvent;
    return invoke<ViewerStatus>("viewer_attach", {
      runId: params.agentRunId,
      columns: params.cols,
      rows: params.rows,
      output,
    });
  },
  input(viewerHandle, data) {
    return invoke("viewer_input", { viewerHandle, data });
  },
  resize(viewerHandle, columns, rows) {
    return invoke("viewer_resize", { viewerHandle, columns, rows });
  },
  scroll(viewerHandle, direction, lines) {
    return invoke("viewer_scroll", { viewerHandle, direction, lines });
  },
  detach(viewerHandle) {
    return invoke<ViewerStatus>("viewer_detach", { viewerHandle });
  },
};

/** Native Tauri implementation of the platform-neutral terminal client. */
export const tauriTerminalClient: TerminalClientTransport = {
  attach(params, onEvent) {
    return openTauriTerminalClient(params, onEvent, tauriViewerBridge, desktopViewerLease);
  },
};

export function openTauriTerminalClient(
  params: TerminalClientAttachParams,
  onEvent: (event: TerminalClientEvent) => void,
  bridge: TauriViewerBridge = tauriViewerBridge,
  leaseClient?: ViewerLeaseClient,
): TerminalClient {
  let viewerHandle: string | null = null;
  let state: TerminalClientStatus = "connecting";
  let detached = false;
  let suspended = false;
  let attachGeneration = 0;
  let leaseId: string | null = null;
  let leaseTimer: ReturnType<typeof setInterval> | null = null;

  function releaseLease(): void {
    if (leaseTimer) clearInterval(leaseTimer);
    leaseTimer = null;
    const id = leaseId;
    leaseId = null;
    if (id && leaseClient) void leaseClient.release(params.agentRunId, id).catch(() => {});
  }

  function replacedByAnotherViewer(): void {
    if (detached || suspended || state !== "ready") return;
    const handle = viewerHandle;
    viewerHandle = null;
    state = "reattachment_required";
    releaseLease();
    if (handle) void bridge.detach(handle).catch(() => {});
    onEvent({ type: "error", layer: "control_plane", message: "replaced_by_another_viewer" });
    onEvent({ type: "reattachment_required", reason: "replaced_by_another_viewer" });
  }

  function startLeaseRenewal(): void {
    if (!leaseClient || !leaseId) return;
    leaseTimer = setInterval(() => {
      const id = leaseId;
      if (!id) return;
      void leaseClient.renew(params.agentRunId, id).catch((error) => {
        if ((error as { code?: string }).code === "replaced_by_another_viewer") {
          replacedByAnotherViewer();
        }
      });
    }, 10_000);
  }

  function reportCommandFailure(error: unknown): void {
    if (detached || suspended) return;
    const failure = classifyCommandFailure(error);
    state = "reattachment_required";
    onEvent({ type: "error", layer: failure.layer, message: failure.message });
    onEvent({ type: "reattachment_required", reason: failure.reason });
  }

  function closeFromViewer(reason: ViewerChannelEvent & { type: "closed" }): void {
    if (detached || suspended || state === "closed") return;
    releaseLease();
    viewerHandle = null;
    state = "closed";
    if (reason.reason.kind === "pty_eof") {
      onEvent({ type: "eof" });
      onEvent({ type: "closed", reason: "pty_eof", code: 0, detail: "pty_eof" });
      return;
    }
    if (reason.reason.kind === "tmux_client_exited") {
      onEvent({
        type: "closed",
        reason: "viewer_exit",
        code: reason.reason.exit_code ?? 0,
        detail: "tmux_client_exited",
      });
      return;
    }
    if (reason.reason.kind === "channel_closed") {
      onEvent({ type: "error", layer: "channel", message: "channel_closed" });
      onEvent({ type: "closed", reason: "channel_closed", code: 0, detail: "channel_closed" });
      return;
    }
    onEvent({
      type: "closed",
      reason: "transport_closed",
      code: reason.reason.exit_code ?? 0,
      detail: reason.reason.kind,
    });
  }

  function attach(isResume = false): void {
    const generation = ++attachGeneration;
    state = "connecting";
    onEvent({ type: "connecting", attempt: 0 });
    const nextLeaseId = leaseClient ? viewerLeaseId() : null;
    if (nextLeaseId) leaseId = nextLeaseId;
    const attachViewer = () => bridge.attach(params, (event) => {
        if (generation !== attachGeneration || detached) return;
        if (event.type === "output") {
          onEvent({ type: "output", bytes: new Uint8Array(event.data) });
        } else if (event.type === "failure") {
          onEvent({ type: "error", layer: event.layer, message: event.message || event.code });
        } else {
          closeFromViewer(event);
        }
      });
    const attach = nextLeaseId
      ? leaseClient!.acquire(params.agentRunId, nextLeaseId).then(attachViewer)
      : attachViewer();
    void attach
      .then((viewer) => {
        if (generation !== attachGeneration || detached || suspended) {
          void bridge.detach(viewer.viewerHandle);
          releaseLease();
          return;
        }
        viewerHandle = viewer.viewerHandle;
        state = "ready";
        startLeaseRenewal();
        onEvent({ type: "ready", sessionId: viewer.viewerHandle, agentRunId: viewer.runId });
        if (isResume) onEvent({ type: "resumed" });
      })
      .catch((error) => {
        releaseLease();
        reportCommandFailure(error);
      });
  }

  function withViewer(action: (handle: string) => Promise<void>): void {
    if (!viewerHandle || state !== "ready" || detached || suspended) return;
    void action(viewerHandle).catch(reportCommandFailure);
  }

  const client: TerminalClient = {
    input(bytes) {
      withViewer((handle) => bridge.input(handle, Array.from(bytes)));
    },
    resize(cols, rows) {
      withViewer((handle) => bridge.resize(handle, cols, rows));
    },
    scroll(direction, lines) {
      withViewer((handle) => bridge.scroll(handle, direction, lines));
    },
    detach() {
      if (detached) return;
      detached = true;
      attachGeneration += 1;
      state = "closed";
      const handle = viewerHandle;
      viewerHandle = null;
      releaseLease();
      if (handle) void bridge.detach(handle).catch(() => {});
      onEvent({ type: "closed", reason: "client_detach", code: 0, detail: "client_detach" });
    },
    suspend() {
      if (!viewerHandle || state !== "ready" || detached || suspended) return false;
      suspended = true;
      attachGeneration += 1;
      state = "suspended";
      const handle = viewerHandle;
      viewerHandle = null;
      releaseLease();
      void bridge.detach(handle).catch(() => {});
      onEvent({ type: "suspended" });
      return true;
    },
    resume() {
      if (!suspended || detached) return;
      suspended = false;
      attach(true);
    },
    status() {
      return state;
    },
  };

  attach();
  return client;
}

function classifyCommandFailure(error: unknown): {
  layer: TerminalClientFailureLayer;
  message: string;
  reason: TerminalClientReattachmentReason;
} {
  const structured = error && typeof error === "object" ? error as ViewerCommandError : null;
  const code = structured?.code;
  const message = structured?.message ?? (typeof error === "string" ? error : "viewer_command_failed");
  const layer = structured?.layer;

  switch (code) {
    case "invalid_run_id":
      return { layer: layer ?? "tmux_attach", message, reason: "invalid_run_id" };
    case "session_not_found":
      return { layer: layer ?? "tmux_attach", message, reason: "session_not_found" };
    case "session_ended":
      return { layer: layer ?? "tmux_attach", message, reason: "session_ended" };
    case "tmux_unavailable":
      return { layer: layer ?? "tmux_attach", message, reason: "tmux_unavailable" };
    case "pty_failed":
      return { layer: layer ?? "pty", message, reason: "pty_failed" };
    case "control_plane_failed":
      return { layer: layer ?? "control_plane", message, reason: "control_plane_failed" };
    case "replaced_by_another_viewer":
      return { layer: layer ?? "control_plane", message, reason: "replaced_by_another_viewer" };
    case "renderer_failed":
      return { layer: layer ?? "renderer", message, reason: "renderer_failed" };
    default:
      return { layer: layer ?? "tmux_attach", message, reason: "reconnect_exhausted" };
  }
}
