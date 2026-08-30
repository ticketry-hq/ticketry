import { describe, expect, it, vi } from "vitest";

import {
  recordTerminalPoolDisposal,
  recordTerminalViewerEvent,
} from "./terminalViewerDiagnostics";

describe("terminal viewer diagnostics", () => {
  it("records viewer closure facts without terminal output", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    recordTerminalViewerEvent({
      sessionId: "run-1",
      agentRunId: "run-1",
      currentStatus: "ready",
      event: {
        type: "closed",
        reason: "viewer_exit",
        code: 1000,
        detail: "terminal_closed",
      },
    });
    recordTerminalViewerEvent({
      sessionId: "run-1",
      agentRunId: "run-1",
      currentStatus: "ready",
      event: { type: "output", bytes: new Uint8Array([115, 101, 99, 114, 101, 116]) },
    });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[terminal-viewer] lifecycle event",
      expect.objectContaining({
        sessionId: "run-1",
        agentRunId: "run-1",
        currentStatus: "ready",
        event: expect.objectContaining({ reason: "viewer_exit", code: 1000 }),
      }),
    );
    expect(info).not.toHaveBeenCalled();
  });

  it("records why a pooled terminal entry was released", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    recordTerminalPoolDisposal({
      sessionId: "run-1",
      agentRunId: "run-1",
      reason: "store_session_removed",
    });

    expect(info).toHaveBeenCalledWith("[terminal-viewer] pooled entry released", {
      sessionId: "run-1",
      agentRunId: "run-1",
      reason: "store_session_removed",
    });
  });
});
