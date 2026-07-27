import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceTerminalHost } from "../../features/agents/terminal/WorkspaceTerminalHost";
import {
  _entryCount,
  disposeAll,
} from "../../features/agents/terminal/internal/entryPool";
import {
  useTerminalStore,
  type SessionMeta,
} from "../../features/agents/terminal";
import type {
  TerminalClient,
  TerminalClientEvent,
} from "../../features/agents/terminal/internal/terminalClient";
import { useWorkspaceTabsStore } from "../../features/agents/terminal/internal/workspaceTabsStore";
import { useIssueDrawerWorkspaceStore } from "../../features/work-items/issue-detail";

const mockState = vi.hoisted(() => ({
  attach: vi.fn(),
  createTerminalRun: vi.fn(),
  events: [] as Array<(event: TerminalClientEvent) => void>,
  dispose: vi.fn(),
  terminals: 0,
}));

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;

    constructor() {
      mockState.terminals += 1;
    }

    loadAddon(addon: { activate?: (terminal: unknown) => void }) {
      addon.activate?.(this);
    }

    attachCustomKeyEventHandler() {}
    onData() {
      return { dispose() {} };
    }
    open() {}
    focus() {}
    write() {}
    dispose() {
      mockState.dispose();
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
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
    attach: (
      params: unknown,
      onEvent: (event: TerminalClientEvent) => void,
    ) => {
      mockState.attach(params);
      mockState.events.push(onEvent);
      return {
        input: vi.fn(),
        resize: vi.fn(),
        scroll: vi.fn(),
        detach: vi.fn(),
        suspend: vi.fn(() => false),
        resume: vi.fn(),
        status: vi.fn(() => "ready"),
      } as unknown as TerminalClient;
    },
  },
}));

vi.mock("../../features/agents/api/agentApi", () => ({
  createTerminalRun: mockState.createTerminalRun,
}));

const session: SessionMeta = {
  sessionId: "local-session",
  taskId: "task-1",
  projectId: "project-1",
  moduleId: "module-1",
  agent: "codex",
  ticketSeq: 1358,
  status: "connecting",
  isPlanning: false,
  isInstant: false,
  initialPrompt: null,
  agentRunId: null,
  isDocChat: false,
  docRelPath: null,
  docId: null,
};

beforeEach(() => {
  mockState.attach.mockReset();
  mockState.createTerminalRun.mockReset();
  mockState.dispose.mockReset();
  mockState.events.length = 0;
  mockState.terminals = 0;

  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );

  useTerminalStore.setState({
    sessions: { [session.sessionId]: session },
    sessionByRun: {},
    persistedSessions: {},
    resumableSessions: {},
  });
  useWorkspaceTabsStore.setState({
    byTaskId: { "task-1": [session.sessionId] },
    activeByTask: { "task-1": session.sessionId },
    chatByDoc: {},
    focusRequest: null,
  });
  useIssueDrawerWorkspaceStore.setState({
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
  disposeAll();
  vi.unstubAllGlobals();
});

describe("terminal launch lifecycle", () => {
  it("creates and attaches one durable run across StrictMode effect replay", async () => {
    let finishCreation!: (value: { agent_run_id: string }) => void;
    mockState.createTerminalRun.mockReturnValue(
      new Promise((resolve) => {
        finishCreation = resolve;
      }),
    );

    const view = render(
      <StrictMode>
        <WorkspaceTerminalHost bucket="task-1" />
      </StrictMode>,
    );

    expect(mockState.createTerminalRun).toHaveBeenCalledTimes(1);
    expect(mockState.attach).not.toHaveBeenCalled();

    await act(async () => {
      finishCreation({ agent_run_id: "run-1" });
    });

    expect(useTerminalStore.getState().sessions["local-session"].agentRunId).toBe("run-1");
    expect(useWorkspaceTabsStore.getState().byTaskId["task-1"]).toEqual(["local-session"]);
    expect(mockState.attach).toHaveBeenCalledTimes(1);
    expect(mockState.attach).toHaveBeenCalledWith(
      expect.objectContaining({ agentRunId: "run-1" }),
    );

    act(() => {
      mockState.events[0]({
        type: "ready",
        sessionId: "server-session",
        agentRunId: "run-1",
      });
    });

    expect(useWorkspaceTabsStore.getState().byTaskId["task-1"]).toEqual(["server-session"]);
    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual(["server-session"]);
    expect(mockState.attach).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it("disposes after a genuine final unmount without attaching the pending run", async () => {
    let finishCreation!: (value: { agent_run_id: string }) => void;
    mockState.createTerminalRun.mockReturnValue(
      new Promise((resolve) => {
        finishCreation = resolve;
      }),
    );

    const view = render(<WorkspaceTerminalHost bucket="task-1" />);
    expect(mockState.createTerminalRun).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {});

    expect(_entryCount()).toBe(0);
    expect(mockState.dispose).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishCreation({ agent_run_id: "run-after-unmount" });
    });

    expect(mockState.createTerminalRun).toHaveBeenCalledTimes(1);
    expect(mockState.attach).not.toHaveBeenCalled();
  });
});
