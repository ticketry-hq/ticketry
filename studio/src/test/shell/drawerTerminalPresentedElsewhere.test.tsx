import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { act } from "react";
import { Terminal } from "../../features/agents/terminal/Terminal";
import {
  useTerminalStore,
  type SessionMeta,
} from "../../features/agents/terminal";
import {
  resolveOwner,
  useTerminalForegroundStore,
} from "../../features/agents/terminal/internal/foregroundStore";

// CODIN-799 — the "presented elsewhere" placeholder + manual reclaim. When
// another surface steals the session's foreground key, <Terminal> shows a
// labelled placeholder instead of a blank pane, and "View here" re-acquires.
// Mounting IS the claim, so the steal is simulated after mount.

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
  terminalClientTransport: {
    attach: () => ({
      input: vi.fn(),
      resize: vi.fn(),
      scroll: vi.fn(),
      detach: vi.fn(),
      suspend: () => false,
      resume: vi.fn(),
      status: () => "ready",
    }),
  },
}));

const meta: SessionMeta = {
  sessionId: "sess-1",
  taskId: "task-1",
  projectId: "proj-1",
  moduleId: "mod-1",
  agent: "claude",
  ticketSeq: 1,
  status: "ready",
  isPlanning: false,
  isInstant: false,
  initialPrompt: null,
  agentRunId: "run-1",
  isDocChat: false,
  docRelPath: null,
  docId: null,
};

beforeEach(() => {
  useTerminalStore.setState({
    sessions: { "sess-1": { ...meta } },
    resumableSessions: {},
  });
  useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    cb();
    return 1;
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
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Terminal presented-elsewhere placeholder", () => {
  it("shows a labelled placeholder when another surface steals the key, and reclaims on click", () => {
    render(<Terminal sessionId="sess-1" owner="studio" />);
    // The issue drawer steals the fallback workspace's session — it must not blank.
    act(() => {
      useTerminalForegroundStore.getState().acquire("run-1", "drawer");
    });

    const placeholder = screen.getByTestId("terminal-presented-elsewhere");
    expect(placeholder.textContent).toContain("the issue drawer");

    fireEvent.click(screen.getByTestId("terminal-reclaim"));

    // The fallback workspace now owns the key and the placeholder is gone.
    expect(resolveOwner(useTerminalForegroundStore.getState(), "run-1")).toBe("studio");
    expect(screen.queryByTestId("terminal-presented-elsewhere")).toBeNull();
  });
});
