import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";

import { SelectedTicketTerminal as TerminalHost } from "../../../../../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal";
import { docChatKey, useTerminalStore } from "../../../../../features/agents/terminal";
import { useTicketWorkspaceStore } from "../../../../../app/shell/ticket-workspace/selected-ticket";
import type { SessionMeta } from "../../../../../features/agents/terminal";
import { useWorkspaceTabsStore } from "../../../../../features/agents/terminal/internal/workspaceTabsStore";

// Hoisted, controllable test doubles shared with the module mocks below.
const H = vi.hoisted(() => ({
  measured: { cols: 100, rows: 40 },
  fitSpy: vi.fn(),
  resizeSpy: vi.fn(),
  closeSpy: vi.fn(),
  openSpy: vi.fn(),
  state: { openArgs: null as Record<string, unknown> | null },
  readyCallback: null as ((sessionId: string, runId: string | null) => void) | null,
  canMeasure: true,
}));

// xterm Terminal — no real DOM/measurement; cols/rows are driven by the fake fit.
vi.mock("xterm", () => ({
  Terminal: class {
    cols: number;
    rows: number;
    constructor(options?: { cols?: number; rows?: number }) {
      this.cols = options?.cols ?? 80;
      this.rows = options?.rows ?? 24;
    }
    loadAddon(a: { activate?: (t: unknown) => void }) {
      a.activate?.(this);
    }
    attachCustomKeyEventHandler() {}
    open() {}
    onData() {
      return { dispose() {} };
    }
    write() {}
    dispose() {}
  },
}));

// FitAddon — fit() records a call and applies the current "measured" geometry.
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    term: { cols: number; rows: number } | null = null;
    activate(t: { cols: number; rows: number }) {
      this.term = t;
    }
    proposeDimensions() {
      return this.term && H.canMeasure ? H.measured : undefined;
    }
    fit() {
      H.fitSpy();
      // Mirror the real FitAddon: proposeDimensions() bails (no resize) until
      // xterm has measured a non-zero cell size, and fit rejects NaN proposals.
      const proposal = this.proposeDimensions();
      if (this.term && proposal && !Number.isNaN(proposal.cols) && !Number.isNaN(proposal.rows)) {
        this.term.cols = proposal.cols;
        this.term.rows = proposal.rows;
      }
    }
    dispose() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
    dispose() {}
  },
}));

vi.mock("../../../../../features/agents/terminal/internal/terminalClientRuntime", () => ({
  terminalClientTransport: {
    attach: (
      args: Record<string, unknown>,
      onEvent: (event: {
        type: "ready";
        sessionId: string;
        agentRunId: string;
      }) => void,
    ) => {
      H.openSpy();
      H.state.openArgs = args;
      H.readyCallback = (sessionId, runId) => {
        onEvent({
          type: "ready",
          sessionId,
          agentRunId: runId ?? "run-1",
        });
      };
      return {
        input: vi.fn(),
        resize: H.resizeSpy,
        scroll: vi.fn(),
        detach: H.closeSpy,
        suspend: () => false,
        resume: vi.fn(),
        status: () => "ready",
      };
    },
  },
}));

// Controllable requestAnimationFrame queue + ResizeObserver + host geometry.
let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
let rafSeq = 1;
let roCallback: (() => void) | null = null;
let hostSize = { w: 800, h: 600 };
const cancelSpy = vi.fn();
const EXCESSIVE_FIT_FRAMES = 20;

function flushRAF() {
  const q = rafQueue;
  rafQueue = [];
  q.forEach((x) => x.cb(0));
}

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

beforeEach(() => {
  window.sessionStorage.clear();
  rafQueue = [];
  rafSeq = 1;
  roCallback = null;
  hostSize = { w: 800, h: 600 };
  H.measured = { cols: 100, rows: 40 };
  H.fitSpy.mockClear();
  H.resizeSpy.mockClear();
  H.openSpy.mockClear();
  H.state.openArgs = null;
  H.readyCallback = null;
  H.canMeasure = true;
  cancelSpy.mockClear();

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = rafSeq++;
    rafQueue.push({ id, cb });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    cancelSpy(id);
    rafQueue = rafQueue.filter((x) => x.id !== id);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        roCallback = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => hostSize.w,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => hostSize.h,
  });

  useTerminalStore.setState({
    sessions: { "sess-1": meta },
    resumableSessions: {},
  });
  useWorkspaceTabsStore.setState({
    activeByTask: { "task-1": "sess-1" },
    byTaskId: { "task-1": ["sess-1"] },
    chatByDoc: {},
  });
  useTicketWorkspaceStore.setState({
    workspaces: {
      "task-1": {
        active: "terminal",
        activeDocId: null,
        docs: [],
        history: [],
        overlayOpenByDoc: {},
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SelectedTicketTerminal fit lifecycle", () => {
  it("opens the WS with the fitted geometry and sends no redundant resize", () => {
    render(<TerminalHost bucket="task-1" />);
    // Synchronous guarded fit seeded the PTY geometry at open time.
    expect(H.state.openArgs).toMatchObject({ cols: 100, rows: 40 });
    // The deferred activation re-fit finds no change → no resize frame.
    act(() => flushRAF());
    expect(H.resizeSpy).not.toHaveBeenCalled();
  });

  it("resends the current geometry once the backend viewer is ready", () => {
    render(<TerminalHost bucket="task-1" />);
    act(() => flushRAF());
    H.resizeSpy.mockClear();

    act(() => H.readyCallback?.("server-session", "run-1"));

    expect(H.resizeSpy).toHaveBeenCalledWith(100, 40);
  });

  it("seeds a restored terminal from the last fitted geometry", () => {
    const first = render(<TerminalHost bucket="task-1" />);
    act(() => flushRAF());
    first.unmount();

    const restored = { ...meta, sessionId: "sess-2", agentRunId: "run-2" };
    useTerminalStore.setState({ sessions: { "sess-2": restored } });
    useWorkspaceTabsStore.setState({
      activeByTask: { "task-1": "sess-2" },
      byTaskId: { "task-1": ["sess-2"] },
      chatByDoc: {},
    });
    H.canMeasure = false;
    H.state.openArgs = null;

    render(<TerminalHost bucket="task-1" />);

    expect(H.state.openArgs).toMatchObject({ cols: 100, rows: 40 });
  });

  it("reattaches a ready live session after the terminal host remounts", async () => {
    const first = render(<TerminalHost bucket="task-1" />);
    act(() => H.readyCallback?.("sess-1", "run-1"));
    first.unmount();
    await act(async () => {});

    expect(useTerminalStore.getState().sessions["sess-1"]).toMatchObject({
      status: "ready",
      agentRunId: "run-1",
    });

    H.state.openArgs = null;
    H.openSpy.mockClear();
    const remounted = render(<TerminalHost bucket="task-1" />);

    expect(H.state.openArgs).toMatchObject({ agentRunId: "run-1" });
    expect(H.openSpy).toHaveBeenCalledTimes(1);

    remounted.rerender(<TerminalHost bucket="task-1" />);
    expect(H.openSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["fractional", JSON.stringify({ cols: 0.5, rows: 1.5 })],
    ["out-of-range", JSON.stringify({ cols: 1001, rows: 24 })],
    ["malformed", "not-json"],
  ])("ignores %s cached terminal geometry", (_case, storedGeometry) => {
    window.sessionStorage.setItem("worktracker:terminal-geometry", storedGeometry);
    H.canMeasure = false;

    render(<TerminalHost bucket="task-1" />);

    expect(H.state.openArgs).toMatchObject({ cols: 80, rows: 24 });
  });

  it("coalesces a burst of ResizeObserver ticks into one fit + one resize", () => {
    render(<TerminalHost bucket="task-1" />);
    act(() => flushRAF()); // settle the activation fit
    H.fitSpy.mockClear();
    H.resizeSpy.mockClear();

    // Window grows; the observer fires several times before the next frame.
    H.measured = { cols: 120, rows: 50 };
    act(() => {
      roCallback?.();
      roCallback?.();
      roCallback?.();
    });
    expect(H.fitSpy).not.toHaveBeenCalled(); // nothing runs until the frame
    act(() => flushRAF());

    expect(H.fitSpy).toHaveBeenCalledTimes(1); // three ticks → one fit
    expect(H.resizeSpy).toHaveBeenCalledTimes(1);
    expect(H.resizeSpy).toHaveBeenCalledWith(120, 50);
  });

  it("skips fitting a zero-size host and re-fits once it becomes measurable", () => {
    hostSize = { w: 0, h: 0 };
    render(<TerminalHost bucket="task-1" />);
    // Guard skipped the synchronous fit → PTY opened at the xterm default.
    expect(H.state.openArgs).toMatchObject({ cols: 80, rows: 24 });
    act(() => flushRAF());
    expect(H.resizeSpy).not.toHaveBeenCalled();

    // Box becomes measurable; the next observer tick re-arms a fit.
    hostSize = { w: 800, h: 600 };
    act(() => roCallback?.());
    act(() => flushRAF());
    expect(H.resizeSpy).toHaveBeenCalledWith(100, 40);
  });

  it("retries the initial fit until xterm can measure its cell size", () => {
    H.canMeasure = false;
    render(<TerminalHost bucket="task-1" />);
    expect(H.state.openArgs).toMatchObject({ cols: 80, rows: 24 });

    act(() => flushRAF());
    expect(H.resizeSpy).not.toHaveBeenCalled();

    // Measurement becomes ready on a later frame without an xterm render or
    // browser resize event to prompt another fit.
    H.canMeasure = true;
    act(() => flushRAF());
    expect(H.resizeSpy).toHaveBeenCalledWith(100, 40);
  });

  it("retries when xterm proposes invalid dimensions", () => {
    H.measured = { cols: Number.NaN, rows: Number.NaN };
    render(<TerminalHost bucket="task-1" />);
    expect(H.state.openArgs).toMatchObject({ cols: 80, rows: 24 });

    act(() => flushRAF());
    expect(H.resizeSpy).not.toHaveBeenCalled();

    H.measured = { cols: 100, rows: 40 };
    act(() => flushRAF());
    expect(H.resizeSpy).toHaveBeenCalledWith(100, 40);
  });

  it("stops retrying when xterm remains unmeasurable", () => {
    H.canMeasure = false;
    render(<TerminalHost bucket="task-1" />);

    for (let attempt = 0; attempt < EXCESSIVE_FIT_FRAMES; attempt += 1) {
      act(() => flushRAF());
    }
    expect(rafQueue).toHaveLength(0);

    H.canMeasure = true;
    act(() => flushRAF());
    expect(H.resizeSpy).not.toHaveBeenCalled();
  });

  it("cancels the pending fit frame on unmount", () => {
    const { unmount } = render(<TerminalHost bucket="task-1" />);
    act(() => roCallback?.()); // arm a frame without flushing
    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });

  // ---------- doc-agent overlay visibleId (#625) ----------

  const DOC = {
    docId: "d1",
    relPath: "spec/x/design.html",
    label: "design",
    open: true,
    reloadToken: 0,
  };

  it("mounts the active doc's doc-chat session when its overlay is open", () => {
    const chatMeta: SessionMeta = {
      ...meta,
      sessionId: "chat-1",
      agentRunId: "run-chat",
      isDocChat: true,
      docRelPath: DOC.relPath,
      docId: DOC.docId,
    };
    useTerminalStore.setState({
      sessions: { "chat-1": chatMeta },
    });
    useWorkspaceTabsStore.setState({
      activeByTask: {}, // no terminal tab focused — only the overlay can resolve
      chatByDoc: { [docChatKey("task-1", DOC.relPath)]: "chat-1" },
    });
    useTicketWorkspaceStore.setState({
      workspaces: {
        "task-1": {
          active: "doc",
          activeDocId: "d1",
          docs: [DOC],
          history: [],
          overlayOpenByDoc: { d1: true },
        },
      },
    });
    render(<TerminalHost bucket="task-1" />);
    // visibleId resolved chatByDoc for the active doc → WS opened for it.
    expect(H.state.openArgs).not.toBeNull();
  });

  it("mounts nothing on a doc when that doc's overlay is closed", () => {
    const chatMeta: SessionMeta = {
      ...meta,
      sessionId: "chat-1",
      isDocChat: true,
      docRelPath: DOC.relPath,
      docId: DOC.docId,
    };
    useTerminalStore.setState({
      sessions: { "chat-1": chatMeta },
    });
    useWorkspaceTabsStore.setState({
      activeByTask: {},
      chatByDoc: { [docChatKey("task-1", DOC.relPath)]: "chat-1" },
    });
    useTicketWorkspaceStore.setState({
      workspaces: {
        "task-1": {
          active: "doc",
          activeDocId: "d1",
          docs: [DOC],
          history: [],
          overlayOpenByDoc: {},
        },
      },
    });
    render(<TerminalHost bucket="task-1" />);
    // overlay closed for this doc → visibleId null → no session mounted.
    expect(H.state.openArgs).toBeNull();
  });
});
