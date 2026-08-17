import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "../../features/agents/terminal/internal/sessionStore";

const terminalNode = document.createElement("div");
const entry = {
  term: {
    cols: 80,
    rows: 24,
    open: vi.fn((host: HTMLElement) => host.appendChild(terminalNode)),
    focus: vi.fn(),
    write: vi.fn((value: string) => {
      terminalNode.textContent += value;
    }),
  },
  fit: {
    fit: vi.fn(),
    proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
  },
  ws: null,
  lastCols: 80,
  lastRows: 24,
  visibleCount: 0,
  suspendTimer: null,
};

vi.mock("../../features/agents/terminal/internal/entryPool", () => ({
  ensureConnected: vi.fn(),
  getEntry: vi.fn(() => entry),
  notifyBackground: vi.fn(),
  notifyForeground: vi.fn(),
  rememberTerminalGeometry: vi.fn(),
}));

import { useTerminalPresentation } from "../../features/agents/terminal/internal/useTerminalPresentation";

function session(sessionId: string): SessionMeta {
  return {
    sessionId,
    taskId: "task-1",
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    status: sessionId.startsWith("tmp_") ? "connecting" : "ready",
    transport: sessionId.startsWith("tmp_") ? "connecting" : "ready",
    isPlanning: false,
    isInstant: true,
    initialPrompt: null,
    agentRunId: "run-1",
  };
}

describe("useTerminalPresentation", () => {
  beforeEach(() => {
    terminalNode.replaceChildren();
    terminalNode.textContent = "";
    entry.term.open.mockClear();
    entry.term.write.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("keeps early output mounted when ready rekeys the same pooled terminal", () => {
    const temporary = session("tmp_1");
    const ready = session("viewer-1");
    const { result, rerender } = renderHook(
      ({ sessionId, value }) =>
        useTerminalPresentation({
          controlledFocus: true,
          session: value,
          sessionId,
        }),
      { initialProps: { sessionId: temporary.sessionId, value: temporary } },
    );
    const host = document.createElement("div");

    act(() => entry.term.write("Directory trust prompt"));
    act(() => {
      result.current.hostRef.current = host;
      rerender({ sessionId: temporary.sessionId, value: temporary });
    });
    act(() => rerender({ sessionId: ready.sessionId, value: ready }));

    expect(entry.term.open).toHaveBeenCalledTimes(1);
    expect(host).toContainElement(terminalNode);
    expect(host).toHaveTextContent("Directory trust prompt");
    expect(result.current.mountedIdRef.current).toBe("viewer-1");
  });
});
