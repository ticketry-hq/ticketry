import { describe, expect, it } from "vitest";

import type { TerminalClientEvent } from "../../internal/terminalClient";
import { createViewerRecovery } from "./viewerRecovery";

const closed = (
  reason: Extract<TerminalClientEvent, { type: "closed" }>["reason"],
): TerminalClientEvent => ({ type: "closed", reason, code: 0, detail: reason });

const reattachmentRequired = (
  reason: Extract<TerminalClientEvent, { type: "reattachment_required" }>["reason"],
): TerminalClientEvent => ({ type: "reattachment_required", reason });

const ready: TerminalClientEvent = {
  type: "ready",
  sessionId: "viewer-1",
  agentRunId: "run-1",
};

describe("viewer recovery policy", () => {
  it("ignores events that do not end the viewer", () => {
    const recovery = createViewerRecovery();
    expect(recovery.plan({ type: "output", bytes: new Uint8Array() }, { active: true }))
      .toBe("ignore");
    expect(recovery.plan(closed("client_detach"), { active: true })).toBe("ignore");
  });

  it("retires the surface when the durable run is gone", () => {
    for (const reason of ["session_ended", "session_not_found", "invalid_run_id"] as const) {
      expect(createViewerRecovery().plan(reattachmentRequired(reason), { active: true }))
        .toBe("retire");
    }
    expect(createViewerRecovery().plan(closed("pty_eof"), { active: true })).toBe("retire");
    expect(createViewerRecovery().plan(closed("viewer_exit"), { active: true })).toBe("retire");
  });

  it("steps aside rather than fighting another window for the lease", () => {
    expect(
      createViewerRecovery().plan(
        reattachmentRequired("replaced_by_another_viewer"),
        { active: true },
      ),
    ).toBe("drop");
  });

  it("reattaches a recoverable failure while presented", () => {
    expect(createViewerRecovery().plan(closed("transport_closed"), { active: true }))
      .toBe("reattach");
    expect(createViewerRecovery().plan(closed("channel_closed"), { active: true }))
      .toBe("reattach");
    expect(createViewerRecovery().plan(reattachmentRequired("pty_failed"), { active: true }))
      .toBe("reattach");
  });

  it("only drops the viewer while hidden", () => {
    expect(createViewerRecovery().plan(closed("transport_closed"), { active: false }))
      .toBe("drop");
  });

  it("does not reattach twice without a healthy viewer in between", () => {
    const recovery = createViewerRecovery();
    expect(recovery.plan(closed("transport_closed"), { active: true })).toBe("reattach");
    expect(recovery.plan(closed("transport_closed"), { active: true })).toBe("drop");

    recovery.plan(ready, { active: true });
    expect(recovery.plan(closed("transport_closed"), { active: true })).toBe("reattach");
  });
});
