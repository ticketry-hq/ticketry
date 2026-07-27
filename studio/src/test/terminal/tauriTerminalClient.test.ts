import { describe, expect, it, vi } from "vitest";

import {
  openTauriTerminalClient,
  type TauriViewerBridge,
} from "../../features/agents/terminal/internal/tauriTerminalClient";
import type { ViewerLeaseClient } from "../../features/agents/terminal/internal/viewerLease";
import type { TerminalClientAttachParams, TerminalClientTransport } from "../../features/agents/terminal/internal/terminalClient";
import {
  terminalClientContractSuite,
  type TerminalClientOperation,
} from "./terminalClientContractSuite";

type FakeViewerChannelEvent =
  | { type: "output"; data: number[] }
  | { type: "failure"; layer: "pty" | "tmux_attach" | "channel"; code: string; message: string }
  | { type: "closed"; reason: { kind: "detached" | "pty_eof" | "tmux_client_exited" | "channel_closed"; exit_code?: number } };

class FakeTauriViewerBridge implements TauriViewerBridge {
  private onChannelEvent: ((event: FakeViewerChannelEvent) => void) | null = null;
  readonly calls: TerminalClientOperation[] = [];

  attach(
    params: TerminalClientAttachParams,
    onChannelEvent: (event: FakeViewerChannelEvent) => void,
  ) {
    this.onChannelEvent = onChannelEvent;
    if (params.agentRunId === "gone") {
      return Promise.reject({ code: "session_not_found", message: "session_not_found" });
    }
    return Promise.resolve({ viewerHandle: "viewer-1", runId: "run-1", lifecycle: "attached" as const });
  }

  input(_viewerHandle: string, data: number[]) {
    this.calls.push({ type: "input", bytes: new Uint8Array(data) });
    return Promise.resolve();
  }

  resize(_viewerHandle: string, cols: number, rows: number) {
    this.calls.push({ type: "resize", cols, rows });
    return Promise.resolve();
  }

  scroll(_viewerHandle: string, direction: "up" | "down", lines: number) {
    this.calls.push({ type: "scroll", direction, lines });
    return Promise.resolve();
  }

  detach() {
    return Promise.resolve({ viewerHandle: "viewer-1", runId: "run-1", lifecycle: "closed" as const });
  }

  output(bytes: Uint8Array): void {
    this.onChannelEvent?.({ type: "output", data: Array.from(bytes) });
  }

  close(kind: "pty_eof" | "tmux_client_exited" | "channel_closed", exitCode?: number): void {
    this.onChannelEvent?.({ type: "closed", reason: { kind, exit_code: exitCode } });
  }

}

describe("Tauri terminal client adapter", () => {
  terminalClientContractSuite(() => {
    const bridge = new FakeTauriViewerBridge();
    const transport: TerminalClientTransport = {
      attach(params, onEvent) {
        return openTauriTerminalClient(params, onEvent, bridge);
      },
    };
    return {
      transport,
      async connect() {
        await Promise.resolve();
      },
      output(bytes: Uint8Array) {
        bridge.output(bytes);
      },
      async missingSession() {
        await Promise.resolve();
      },
      operations() {
        return bridge.calls;
      },
    };
  });

  it("forwards each scroll intent across the native bridge exactly once", async () => {
    const bridge = new FakeTauriViewerBridge();
    const client = openTauriTerminalClient(
      { agentRunId: "run-scroll", cols: 80, rows: 24 },
      () => {},
      bridge,
    );
    await Promise.resolve();

    client.scroll("down", 7);

    expect(bridge.calls).toEqual([{ type: "scroll", direction: "down", lines: 7 }]);
  });

  it.each([
    ["bad", { code: "invalid_run_id", layer: "tmux_attach", message: "invalid" }, "tmux_attach", "invalid_run_id"],
    ["gone", { code: "session_not_found", layer: "tmux_attach", message: "missing" }, "tmux_attach", "session_not_found"],
    ["ended", { code: "session_ended", layer: "tmux_attach", message: "ended" }, "tmux_attach", "session_ended"],
    ["pty", { code: "pty_failed", layer: "pty", message: "read" }, "pty", "pty_failed"],
  ] as const)("makes %s a recoverable, layered failure", async (runId, error, layer, reason) => {
    const bridge: TauriViewerBridge = {
      attach: () => Promise.reject(error),
      input: () => Promise.resolve(),
      resize: () => Promise.resolve(),
      scroll: () => Promise.resolve(),
      detach: () => Promise.resolve({ viewerHandle: "viewer-1", runId, lifecycle: "closed" }),
    };
    const events: import("../../features/agents/terminal/internal/terminalClient").TerminalClientEvent[] = [];
    openTauriTerminalClient({ agentRunId: runId, cols: 80, rows: 24 }, (event) => events.push(event), bridge);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContainEqual({ type: "error", layer, message: error.message });
    expect(events).toContainEqual({ type: "reattachment_required", reason });
  });

  it("keeps PTY EOF distinct from a tmux viewer-client exit", async () => {
    const bridge = new FakeTauriViewerBridge();
    const eofEvents: import("../../features/agents/terminal/internal/terminalClient").TerminalClientEvent[] = [];
    openTauriTerminalClient({ agentRunId: "run-1", cols: 80, rows: 24 }, (event) => eofEvents.push(event), bridge);
    await Promise.resolve();
    bridge.close("pty_eof");
    expect(eofEvents).toContainEqual({ type: "eof" });
    expect(eofEvents).toContainEqual({ type: "closed", reason: "pty_eof", code: 0, detail: "pty_eof" });

    const exitBridge = new FakeTauriViewerBridge();
    const exitEvents: import("../../features/agents/terminal/internal/terminalClient").TerminalClientEvent[] = [];
    openTauriTerminalClient({ agentRunId: "run-2", cols: 80, rows: 24 }, (event) => exitEvents.push(event), exitBridge);
    await Promise.resolve();
    exitBridge.close("tmux_client_exited", 17);
    expect(exitEvents).toContainEqual({ type: "closed", reason: "viewer_exit", code: 17, detail: "tmux_client_exited" });
  });

  it("acquires and releases the durable desktop lease without routing terminal bytes through it", async () => {
    const bridge = new FakeTauriViewerBridge();
    const calls: string[] = [];
    const lease: ViewerLeaseClient = {
      acquire: async (runId, viewerId) => { calls.push(`acquire:${runId}:${viewerId}`); },
      renew: async () => {},
      release: async (runId, viewerId) => { calls.push(`release:${runId}:${viewerId}`); },
    };
    const events: import("../../features/agents/terminal/internal/terminalClient").TerminalClientEvent[] = [];
    const client = openTauriTerminalClient(
      { agentRunId: "run-lease", cols: 80, rows: 24 },
      (event) => events.push(event),
      bridge,
      lease,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    client.detach();

    expect(calls[0]).toMatch(/^acquire:run-lease:desktop-/);
    expect(calls[1]).toMatch(/^release:run-lease:desktop-/);
    expect(events).toContainEqual({ type: "ready", sessionId: "viewer-1", agentRunId: "run-1" });
  });

  it("surfaces replacement by another viewer from the durable lease", async () => {
    vi.useFakeTimers();
    try {
      const bridge = new FakeTauriViewerBridge();
      const lease: ViewerLeaseClient = {
        acquire: async () => {},
        renew: async () => {
          throw Object.assign(new Error("replaced_by_another_viewer"), {
            code: "replaced_by_another_viewer",
          });
        },
        release: async () => {},
      };
      const events: import("../../features/agents/terminal/internal/terminalClient").TerminalClientEvent[] = [];
      openTauriTerminalClient(
        { agentRunId: "run-replaced", cols: 80, rows: 24 },
        (event) => events.push(event),
        bridge,
        lease,
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(events).toContainEqual({
        type: "error",
        layer: "control_plane",
        message: "replaced_by_another_viewer",
      });
      expect(events).toContainEqual({
        type: "reattachment_required",
        reason: "replaced_by_another_viewer",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
