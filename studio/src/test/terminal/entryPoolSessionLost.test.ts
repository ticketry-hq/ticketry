import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disposeAll,
  ensureConnected,
  syncEntries,
} from "../../features/agents/terminal/internal/entryPool";
import {
  useTerminalStore,
  type SessionMeta,
} from "../../features/agents/terminal";
import type { TerminalClientEvent } from "../../features/agents/terminal/internal/terminalClient";

// CODIN-799/800 — the socket classifies a confirmed missing attach target and
// the pool records that semantic outcome instead of a generic transport error.

const H = vi.hoisted(() => ({
  cbs: null as ((event: TerminalClientEvent) => void) | null,
}));

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon(a: { activate?: (t: unknown) => void }) {
      a.activate?.(this);
    }
    attachCustomKeyEventHandler() {}
    open() {}
    onData() {
      return { dispose() {} };
    }
    onRender() {
      return { dispose() {} };
    }
    write() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    fit() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
    dispose() {}
  },
}));

vi.mock("../../features/agents/terminal/internal/terminalClientRuntime", () => ({
  terminalClientTransport: { attach: (_params: unknown, cbs: (event: TerminalClientEvent) => void) => {
    H.cbs = cbs;
    return {
      input: vi.fn(),
      resize: vi.fn(),
      scroll: vi.fn(),
      detach: vi.fn(),
      suspend: () => false,
      resume: vi.fn(),
      status: () => "ready",
    };
  } },
}));

const baseMeta: SessionMeta = {
  sessionId: "sess-1",
  taskId: "task-1",
  projectId: "proj-1",
  moduleId: "mod-1",
  agent: "claude",
  ticketSeq: 1,
  status: "connecting",
  isPlanning: false,
  isInstant: false,
  initialPrompt: null,
  agentRunId: "run-1",
  isDocChat: false,
  docRelPath: null,
  docId: null,
};

function seedAndConnect() {
  const meta = { ...baseMeta };
  useTerminalStore.setState({
    sessions: { "sess-1": meta },
    resumableSessions: {},
  });
  syncEntries({ "sess-1": meta });
  ensureConnected("sess-1", meta);
}

beforeEach(() => {
  H.cbs = null;
  useTerminalStore.setState({
    sessions: {},
    persistedSessions: {},
    resumableSessions: {},
  });
});

afterEach(() => {
  disposeAll();
});

describe("terminalEntryPool onClose triage", () => {
  it("marks a backend-confirmed missing attach target as session_lost", () => {
    seedAndConnect();
    H.cbs?.({ type: "reattachment_required", reason: "session_not_found" });
    expect(useTerminalStore.getState().sessions["sess-1"].status).toBe("session_lost");
  });

  it("marks a generic non-clean close (1006) as error", () => {
    seedAndConnect();
    H.cbs?.({ type: "closed", reason: "transport_closed", code: 1006, detail: "abnormal" });
    expect(useTerminalStore.getState().sessions["sess-1"].status).toBe("error");
  });

  it("marks a clean close (1000) as exited", () => {
    seedAndConnect();
    H.cbs?.({ type: "closed", reason: "viewer_exit", code: 1000, detail: "bye" });
    const session = useTerminalStore.getState().sessions["sess-1"];
    expect(session.status).toBe("viewer_closed");
    expect(session.backendSession).toBeUndefined();
  });

  it("records PTY EOF without terminating the durable run", () => {
    seedAndConnect();
    H.cbs?.({ type: "closed", reason: "pty_eof", code: 0, detail: "pty_eof" });
    const session = useTerminalStore.getState().sessions["sess-1"];
    expect(session.status).toBe("pty_eof");
    expect(session.backendSession).toBeUndefined();
  });
});
