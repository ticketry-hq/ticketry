import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";

import { SelectedTicketTerminal as TerminalHost } from "../../../../../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal";
import {
  _entryCount,
  getEntry,
  registerPoolDriver,
  SUSPEND_GRACE_MS,
} from "../../../../../features/agents/terminal/internal/entryPool";
import { useTerminalStore } from "../../../../../features/agents/terminal";
import type { SessionMeta } from "../../../../../features/agents/terminal";
import { useTicketWorkspaceStore } from "../../../../../app/shell/ticket-workspace/selected-ticket";
import {
  foregroundKey,
  resolveOwner,
  useTerminalForegroundStore,
} from "../../../../../features/agents/terminal/internal/foregroundStore";
import type { TerminalClientEvent } from "../../../../../features/agents/terminal/internal/terminalClient";
import { useWorkspaceTabsStore } from "../../../../../features/agents/terminal/internal/workspaceTabsStore";

// CODIN-749 — relocated pool + registry arbitration integration (jsdom). Proves single
// foreground owner, no duplicate xterm/WS on ownership transfer, scrollback /
// identity preservation, and lifecycle release.

const H = vi.hoisted(() => ({
  termCount: 0,
  openCount: 0,
  onEvent: null as ((event: TerminalClientEvent) => void) | null,
  closeSpy: vi.fn(),
  suspendSpy: vi.fn(),
  resumeSpy: vi.fn(),
  suspended: false,
}));

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    constructor() {
      H.termCount += 1;
    }
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
    term: { cols: number; rows: number } | null = null;
    activate(t: { cols: number; rows: number }) {
      this.term = t;
    }
    fit() {
      if (this.term) {
        this.term.cols = 100;
        this.term.rows = 40;
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
    attach: (_params: unknown, onEvent: (event: TerminalClientEvent) => void) => {
      H.openCount += 1;
      H.onEvent = onEvent;
      return {
        input: vi.fn(),
        resize: vi.fn(),
        scroll: vi.fn(),
        detach: H.closeSpy,
        // Stateful, like the real handle: the suspend-policy tests assert the
        // pool's grace-timer decisions through these.
        suspend: () => {
          H.suspendSpy();
          H.suspended = true;
          return true;
        },
        resume: () => {
          H.resumeSpy();
          H.suspended = false;
        },
        status: () => (H.suspended ? "suspended" : "ready"),
      };
    },
  },
}));

let rafQueue: Array<() => void> = [];

function flushRAF() {
  const q = rafQueue;
  rafQueue = [];
  q.forEach((cb) => cb());
}

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

function seedConnectingSession() {
  useTerminalStore.setState({
    sessions: { "sess-1": { ...baseMeta } },
    resumableSessions: {},
  });
  useWorkspaceTabsStore.setState({
    byTaskId: { "task-1": ["sess-1"] },
    activeByTask: { "task-1": "sess-1" },
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
}

// Drive the WS to `ready`, promoting sess-1 -> server-1 / run-1 (the tmp rekey).
function driveReady() {
  act(() => {
    H.onEvent?.({ type: "ready", sessionId: "server-1", agentRunId: "run-1" });
  });
}

beforeEach(() => {
  rafQueue = [];
  H.termCount = 0;
  H.openCount = 0;
  H.onEvent = null;
  H.closeSpy.mockClear();
  H.suspendSpy.mockClear();
  H.resumeSpy.mockClear();
  H.suspended = false;
  useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });

  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CODIN-749 foreground arbitration", () => {
  it("creates the Terminal once and opens the WS once across a studio→drawer→studio transfer", () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    expect(H.openCount).toBe(1); // studio opened the socket
    expect(H.termCount).toBe(1);
    driveReady(); // sess-1 -> server-1 / run-1
    expect(_entryCount()).toBe(1);

    const key = "run-1";
    // Drawer claims foreground; studio must back off, NOT close/reopen anything.
    act(() => useTerminalForegroundStore.getState().acquire(key, "drawer"));
    act(() => flushRAF());
    // Drawer releases; studio re-acquires eligibility.
    act(() => useTerminalForegroundStore.getState().release(key));
    act(() => flushRAF());

    expect(H.openCount).toBe(1); // no second WS viewer
    expect(H.termCount).toBe(1); // no second xterm
    expect(H.closeSpy).not.toHaveBeenCalled(); // run not torn down on transfer
    expect(_entryCount()).toBe(1);
    view.unmount();
  });

  it("preserves session identity and the same Terminal instance across a transfer", () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    driveReady();
    const termBefore = getEntry("server-1")?.term;

    const key = "run-1";
    act(() => useTerminalForegroundStore.getState().acquire(key, "drawer"));
    act(() => flushRAF());
    act(() => useTerminalForegroundStore.getState().release(key));
    act(() => flushRAF());

    expect(getEntry("server-1")?.term).toBe(termBefore); // same buffer/scrollback
    expect(useWorkspaceTabsStore.getState().activeByTask["task-1"]).toBe("server-1");
    view.unmount();
  });

  it("backs off (no attach, no WS) when the drawer already owns the session", () => {
    seedConnectingSession();
    // Drawer claims the connecting session's live-id key before studio renders.
    act(() =>
      useTerminalForegroundStore
        .getState()
        .acquire(foregroundKey(baseMeta), "drawer"),
    );
    const view = render(<TerminalHost bucket="task-1" />);
    expect(H.openCount).toBe(0); // studio did not open a competing socket
    // The session, its tab and its bucket remain intact — studio is only
    // backgrounded for it, not torn down.
    expect(useTerminalStore.getState().sessions["sess-1"]).toBeDefined();
    expect(useWorkspaceTabsStore.getState().byTaskId["task-1"]).toEqual(["sess-1"]);
    view.unmount();
  });

  it("releases the drawer claim on session exit without killing the run", () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    driveReady();
    const key = "run-1";
    act(() => useTerminalForegroundStore.getState().acquire(key, "drawer"));
    expect(resolveOwner(useTerminalForegroundStore.getState(), key)).toBe(
      "drawer",
    );

    // A clean exit releases the claim, returning the key to studio-eligible.
    act(() => useTerminalStore.getState().setExited("server-1"));
    expect(resolveOwner(useTerminalForegroundStore.getState(), key)).toBe(
      "studio",
    );
    view.unmount();
  });

  it("keeps pooled entries alive until the last driver unmounts (CODIN-751)", async () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    driveReady();
    expect(_entryCount()).toBe(1);

    // A second driver (the drawer's DrawerTerminalHost, mounted in the Studio
    // shell) registers while the fallback host is showing the session.
    const releaseDrawerDriver = registerPoolDriver();
    // The fallback host unmounts: the pool must NOT be disposed —
    // the drawer is still driving it and showing a live session.
    view.unmount();
    expect(_entryCount()).toBe(1);
    expect(H.closeSpy).not.toHaveBeenCalled();

    // Only when the final driver releases are entries torn down.
    releaseDrawerDriver();
    await act(async () => {});
    expect(_entryCount()).toBe(0);
  });

  it("uses the fallback host when there are no drawer claims", () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    act(() => flushRAF());
    // With no claims every key resolves to studio: the socket opened and the
    // session presents normally.
    expect(H.openCount).toBe(1);
    expect(resolveOwner(useTerminalForegroundStore.getState(), "sess-1")).toBe(
      "studio",
    );
    view.unmount();
  });
});

// Suspend policy: a session no surface presents stops streaming after the
// grace period and resumes transparently on refocus.
describe("background transport suspension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Switch the ticket's workspace to a non-terminal tab so the fallback host stops
  // presenting the session (visibleId → null) without touching the session.
  function switchToSelectedTicketDetails() {
    act(() => {
      useTicketWorkspaceStore.setState({
        workspaces: {
          "task-1": {
            active: "details",
            activeDocId: null,
            docs: [],
            history: [],
            overlayOpenByDoc: {},
          },
        },
      });
    });
  }

  function switchToTerminalTab() {
    act(() => {
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
  }

  it("suspends after the grace period once backgrounded, without touching the session", () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    driveReady();

    switchToSelectedTicketDetails();
    expect(H.suspendSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SUSPEND_GRACE_MS);
    });
    expect(H.suspendSpy).toHaveBeenCalledTimes(1);
    // Transport-only: the socket was suspended, never lifecycle-closed, and
    // the tab is still a live `ready` session in the store.
    expect(H.closeSpy).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().sessions["server-1"].status).toBe("ready");
    expect(_entryCount()).toBe(1);
    view.unmount();
  });

  it("does not suspend while the terminal stays visible", () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    driveReady();
    act(() => {
      vi.advanceTimersByTime(SUSPEND_GRACE_MS * 3);
    });
    expect(H.suspendSpy).not.toHaveBeenCalled();
    view.unmount();
  });

  it("a studio→drawer→studio transfer within the grace window never suspends", () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    driveReady();

    const key = "run-1";
    act(() => useTerminalForegroundStore.getState().acquire(key, "drawer"));
    act(() => {
      vi.advanceTimersByTime(SUSPEND_GRACE_MS / 2);
    });
    act(() => useTerminalForegroundStore.getState().release(key));
    act(() => {
      vi.advanceTimersByTime(SUSPEND_GRACE_MS * 2);
    });
    expect(H.suspendSpy).not.toHaveBeenCalled();
    expect(H.openCount).toBe(1);
    view.unmount();
  });

  it("resumes the suspended transport on refocus", () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    driveReady();

    switchToSelectedTicketDetails();
    act(() => {
      vi.advanceTimersByTime(SUSPEND_GRACE_MS);
    });
    expect(H.suspendSpy).toHaveBeenCalledTimes(1);

    switchToTerminalTab();
    expect(H.resumeSpy).toHaveBeenCalledTimes(1);
    // Resume re-attaches inside the existing handle — no second WS viewer.
    expect(H.openCount).toBe(1);
    view.unmount();
  });

  it("pool teardown with a pending grace timer never fires a stray suspend", async () => {
    seedConnectingSession();
    const view = render(<TerminalHost bucket="task-1" />);
    driveReady();

    switchToSelectedTicketDetails();
    // Last driver unmounts → disposeAll clears the pending timer and closes.
    view.unmount();
    await act(async () => {});
    expect(_entryCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(SUSPEND_GRACE_MS * 2);
    });
    expect(H.suspendSpy).not.toHaveBeenCalled();
    expect(H.closeSpy).toHaveBeenCalled();
  });
});
