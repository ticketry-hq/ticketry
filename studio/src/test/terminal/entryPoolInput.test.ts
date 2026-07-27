import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disposeAll,
  ensureConnected,
  getEntry,
  notifyBackground,
  notifyForeground,
  releasePooledTransport,
  syncEntries,
} from "../../features/agents/terminal/internal/entryPool";
import {
  useTerminalStore,
  type SessionMeta,
} from "../../features/agents/terminal";
import type {
  TerminalClient,
  TerminalClientEvent,
} from "../../features/agents/terminal/internal/terminalClient";

type KeyHandler = (event: KeyboardEvent) => boolean;
type DataHandler = (data: string) => void;

const mockState = vi.hoisted(() => ({
  terminals: [] as Array<{
    keyHandlers: KeyHandler[];
    dataHandlers: DataHandler[];
    open: () => void;
    reset: () => void;
  }>,
  sockets: [] as TerminalClient[],
  callbacks: [] as Array<(event: TerminalClientEvent) => void>,
  socketParams: [] as unknown[],
  createTerminalRun: vi.fn(),
}));

vi.mock("xterm", () => ({
  Terminal: class {
    keyHandlers: KeyHandler[] = [];
    dataHandlers: DataHandler[] = [];

    constructor() {
      mockState.terminals.push(this);
    }

    loadAddon(addon: { activate?: (terminal: unknown) => void }) {
      addon.activate?.(this);
    }

    attachCustomKeyEventHandler(handler: KeyHandler) {
      this.keyHandlers.push(handler);
    }

    onData(handler: DataHandler) {
      this.dataHandlers.push(handler);
      return {
        dispose: () => {
          const index = this.dataHandlers.indexOf(handler);
          if (index !== -1) this.dataHandlers.splice(index, 1);
        },
      };
    }

    open() {}
    reset() {}
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
  terminalClientTransport: { attach: (params: unknown, callbacks: (event: TerminalClientEvent) => void) => {
    const handle = {
      input: vi.fn(),
      resize: vi.fn(),
      scroll: vi.fn(),
      detach: vi.fn(),
      suspend: vi.fn(() => false),
      resume: vi.fn(),
      status: vi.fn(() => "ready"),
    } as unknown as TerminalClient;
    mockState.sockets.push(handle);
    mockState.callbacks.push(callbacks);
    mockState.socketParams.push(params);
    return handle;
  } },
}));

vi.mock("../../features/agents/api/agentApi", () => ({
  createTerminalRun: mockState.createTerminalRun,
}));

const meta: SessionMeta = {
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

function connectEntry() {
  syncEntries({ "sess-1": meta });
  ensureConnected("sess-1", meta);
  return {
    terminal: mockState.terminals[0],
    socket: mockState.sockets[0],
  };
}

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    type: "keydown",
    key: "Enter",
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

beforeEach(() => {
  mockState.terminals.length = 0;
  mockState.sockets.length = 0;
  mockState.callbacks.length = 0;
  mockState.socketParams.length = 0;
  mockState.createTerminalRun.mockReset();
});

afterEach(() => {
  disposeAll();
});

describe("pooled terminal input", () => {
  it("creates a durable run before opening an attach-only socket", async () => {
    mockState.createTerminalRun.mockResolvedValue({ agent_run_id: "run-created" });
    const fresh = { ...meta, agentRunId: null };
    syncEntries({ "sess-1": fresh });

    ensureConnected("sess-1", fresh);

    expect(mockState.createTerminalRun).toHaveBeenCalledWith({
      agent: "claude",
      project_id: "proj-1",
      module_id: "mod-1",
      task_id: "task-1",
      initial_prompt: null,
      is_planning: false,
      is_instant: false,
      instant_prompt: null,
      is_doc_chat: false,
      doc_rel_path: null,
      doc_id: null,
    });
    expect(mockState.sockets).toHaveLength(0);

    await vi.waitFor(() => expect(mockState.sockets).toHaveLength(1));
    expect(mockState.socketParams[0]).toMatchObject({ agentRunId: "run-created" });
  });

  it("creates only one durable run while repeated connection effects are pending", async () => {
    let finishCreation!: (value: { agent_run_id: string }) => void;
    mockState.createTerminalRun.mockReturnValue(
      new Promise((resolve) => {
        finishCreation = resolve;
      }),
    );
    const fresh = { ...meta, agentRunId: null };
    useTerminalStore.setState({ sessions: { "sess-1": fresh } });
    syncEntries({ "sess-1": fresh });

    ensureConnected("sess-1", fresh);
    // A second mounted presenter may flush an older render after this session
    // has already entered the store. It must not dispose the shared in-flight
    // entry and let the following current render recreate another launcher.
    syncEntries({});
    syncEntries({ "sess-1": fresh });
    ensureConnected("sess-1", fresh);

    expect(mockState.createTerminalRun).toHaveBeenCalledTimes(1);
    expect(mockState.sockets).toHaveLength(0);

    finishCreation({ agent_run_id: "run-created" });
    await vi.waitFor(() => expect(mockState.sockets).toHaveLength(1));
    expect(mockState.createTerminalRun).toHaveBeenCalledTimes(1);
  });

  it("sends ESC + CR once and suppresses xterm for exact Shift+Enter", () => {
    const { terminal, socket } = connectEntry();

    expect(terminal.keyHandlers).toHaveLength(1);
    expect(terminal.keyHandlers[0](keyEvent())).toBe(false);
    expect(socket.input).toHaveBeenCalledTimes(1);
    expect(socket.input).toHaveBeenCalledWith(new Uint8Array([0x1b, 0x0d]));
  });

  it("leaves plain Enter on xterm's normal CR data path", () => {
    const { terminal, socket } = connectEntry();

    expect(terminal.keyHandlers[0](keyEvent({ shiftKey: false }))).toBe(true);
    terminal.dataHandlers[0]("\r");

    expect(socket.input).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(socket.input).mock.calls[0][0];
    expect(sent.constructor.name).toBe("Uint8Array");
    expect(Array.from(sent)).toEqual([0x0d]);
  });

  it("cannot leak a trailing CR after handled Shift+Enter", () => {
    const { terminal, socket } = connectEntry();

    const letXtermHandleEvent = terminal.keyHandlers[0](keyEvent());
    if (letXtermHandleEvent) terminal.dataHandlers[0]("\r");

    expect(letXtermHandleEvent).toBe(false);
    expect(socket.input).toHaveBeenCalledTimes(1);
    expect(socket.input).toHaveBeenCalledWith(new Uint8Array([0x1b, 0x0d]));
  });

  it.each([
    ["plain Enter", { shiftKey: false }],
    ["Ctrl+Shift+Enter", { ctrlKey: true }],
    ["Alt+Shift+Enter", { altKey: true }],
    ["Meta+Shift+Enter", { metaKey: true }],
    ["another key", { key: "a" }],
    ["keyup", { type: "keyup" }],
    ["composition", { isComposing: true }],
  ])("delegates %s to xterm unchanged", (_label, overrides) => {
    const { terminal, socket } = connectEntry();

    expect(terminal.keyHandlers[0](keyEvent(overrides))).toBe(true);
    expect(socket.input).not.toHaveBeenCalled();
  });

  it("registers one handler for the pooled entry across lifecycle changes", () => {
    const { terminal } = connectEntry();
    const entry = getEntry("sess-1");
    expect(entry).toBeDefined();

    syncEntries({ "sess-1": meta });
    ensureConnected("sess-1", meta);
    notifyForeground(entry!);
    notifyBackground(entry!);
    terminal.open();
    terminal.reset();
    mockState.callbacks[0]({ type: "connecting", attempt: 1 });
    mockState.callbacks[0]({ type: "ready", sessionId: "sess-1", agentRunId: "run-1" });

    expect(mockState.terminals).toHaveLength(1);
    expect(mockState.sockets).toHaveLength(1);
    expect(terminal.keyHandlers).toHaveLength(1);
    expect(terminal.dataHandlers).toHaveLength(1);
  });

  it("replaces the input handler when a released transport reattaches", () => {
    const { terminal, socket: firstSocket } = connectEntry();

    releasePooledTransport("sess-1");
    ensureConnected("sess-1", meta);

    expect(mockState.sockets).toHaveLength(2);
    expect(terminal.dataHandlers).toHaveLength(1);

    terminal.dataHandlers[0]("x");

    expect(firstSocket.input).not.toHaveBeenCalled();
    expect(mockState.sockets[1].input).toHaveBeenCalledTimes(1);
    expect(mockState.sockets[1].input).toHaveBeenCalledWith(
      new TextEncoder().encode("x"),
    );
  });
});
