import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { Terminal } from "../features/agents/terminal/Terminal";
import { WorkspaceTabBody } from "../app/shell/ticket-workspace/selected-ticket/internal/WorkspaceTabBody";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useClientStore } from "../state/clientStore";
import {
  grantsEveryLease,
  installDesktopGraphQlRuntime,
} from "./desktopGraphQlRuntime";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauri.listen,
}));

vi.mock("../features/agents/terminal/internal/entryPool", () => ({
  getEntry: () => null,
  registerPoolDriver: () => () => {},
  releasePooledTransport: vi.fn(),
  syncEntries: vi.fn(),
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

describe("native viewer attachment acceptance", () => {
  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  });

  beforeEach(() => {
    vi.resetAllMocks();
    installDesktopGraphQlRuntime();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({ activeByTask: {} });
    useTerminalStore.setState({
      sessions: {
        "session-1": {
          sessionId: "session-1",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          status: "ready",
          transport: "ready",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-1",
        },
      },
      sessionByRun: { "run-1": "session-1" },
    });
    tauri.listen.mockResolvedValue(() => {});
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_available") {
        return Promise.resolve(true);
      }
      if (command === "native_terminal_attach") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_set_frame") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_show") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      return Promise.resolve();
    });
  });

  it("[overhaul-48] waits for desktop Ghostty without mounting the WebSocket fallback", async () => {
    let resolveAvailability!: (available: boolean) => void;
    const availability = new Promise<boolean>((resolve) => {
      resolveAvailability = resolve;
    });
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_available") return availability;
      if (command === "native_terminal_attach") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_set_frame") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      return Promise.resolve();
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    const view = render(<Terminal sessionId="session-1" />);
    expect(view.getByTestId("terminal-renderer-pending")).toBeVisible();
    expect(view.queryByTestId("terminal-host")).not.toBeInTheDocument();
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "native_terminal_attach",
      expect.anything(),
    );

    resolveAvailability(true);

    await waitFor(() => {
      expect(view.getByTestId("native-terminal-host")).toHaveAttribute(
        "data-terminal-renderer",
        "libghostty",
      );
    });
    expect(view.queryByTestId("terminal-host")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_attach", {
        runId: "run-1",
        viewerId: expect.any(String),
        frame: {
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          viewportWidth: 800,
          viewportHeight: 600,
        },
      });
    });

    view.unmount();
  });

  it("creates a fresh desktop run before Ghostty without mounting xterm", async () => {
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (command === "native_terminal_attach") {
        return Promise.resolve({
          handle: "native-fresh",
          runId: "run-fresh",
          columns: 100,
          rows: 30,
        });
      }
      return Promise.resolve();
    });
    // The run is created on the Rust terminal graph, never on a host route.
    const host = vi.fn();
    vi.stubGlobal("fetch", host);
    installDesktopGraphQlRuntime(async (document, variables) => {
      if (document.operationName === "CreateTerminalSession") {
        return { terminal_session: { agent_run_id: "run-fresh" } } as never;
      }
      return grantsEveryLease(document, variables);
    });
    useTerminalStore.setState({
      sessions: {
        "tmp-fresh": {
          sessionId: "tmp-fresh",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          status: "connecting",
          transport: "connecting",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: null,
        },
      },
      sessionByRun: {},
    });

    const view = render(<Terminal sessionId="tmp-fresh" />);
    expect(view.getByTestId("terminal-renderer-pending")).toBeVisible();
    expect(view.queryByTestId("terminal-host")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(useTerminalStore.getState().sessions["tmp-fresh"]?.agentRunId).toBe(
        "run-fresh",
      );
    });
    expect(view.queryByTestId("terminal-host")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith(
        "native_terminal_attach",
        expect.objectContaining({ runId: "run-fresh" }),
      );
    });
    expect(view.queryByTestId("terminal-host")).not.toBeInTheDocument();
    expect(host).not.toHaveBeenCalled();
    view.unmount();
  });

  it("retains one durable native viewer while workspace surfaces are inactive", async () => {
    const operations = installDesktopGraphQlRuntime();
    const claimed = (operationName: string) =>
      operations.filter((operation) => operation.operationName === operationName);
    const ready = vi.fn();
    const view = render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        active
        onReady={ready}
      />,
    );
    await waitFor(() => expect(ready).toHaveBeenCalledOnce());

    view.rerender(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        active={false}
        onReady={ready}
      />,
    );
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_hide", {
        handle: "native-1",
      });
    });
    expect(tauri.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_attach"
    )).toHaveLength(1);
    expect(tauri.invoke).not.toHaveBeenCalledWith("native_terminal_detach", {
      handle: "native-1",
    });
    expect(claimed("CreateViewerLease")).toHaveLength(1);
    expect(claimed("DeleteViewerLease")).toHaveLength(0);

    view.rerender(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        active
        onReady={ready}
      />,
    );
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_show", {
        handle: "native-1",
        frame: {
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          viewportWidth: 800,
          viewportHeight: 600,
        },
      });
    });
    expect(tauri.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_attach"
    )).toHaveLength(1);
    expect(claimed("CreateViewerLease")).toHaveLength(1);
    view.unmount();
  });

  it("[overhaul-72] shields destination content until a retained native viewer is hidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    let finishHide: (() => void) | null = null;
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (command === "native_terminal_attach") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_hide") {
        return new Promise<void>((resolve) => {
          finishHide = resolve;
        });
      }
      return Promise.resolve();
    });
    useClientStore.setState({ activeByTask: { "task-1": "session-1" } });

    const bodyRef = createRef<HTMLDivElement>();
    const detailsSurfaceRef = createRef<HTMLDivElement>();
    const sharedProps = {
      bodyRef,
      detailsSurfaceRef,
      bucket: "task-1",
      owner: "studio" as const,
      details: <div>Destination details</div>,
      activeDocument: null,
      openDocuments: [],
      terminalIds: ["session-1"],
      activeTerminalId: "session-1",
      requestedSurface: null,
      surfaceFocusSignal: 0,
      requestedTerminalId: null,
      terminalFocusSignal: 0,
      isEditView: false,
      editViewZone: "active-tab-body" as const,
      showZoneChrome: false,
      bodyEngaged: false,
      onClaimPointerZone: vi.fn(),
      onEngageTab: vi.fn(),
      onSetEditViewZone: vi.fn(),
    };
    const view = render(
      <WorkspaceTabBody
        {...sharedProps}
        activeKind="terminal"
        activeTab={{ kind: "terminal", id: "session-1" }}
      />,
    );
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith(
        "native_terminal_attach",
        expect.anything(),
      );
    });

    view.rerender(
      <WorkspaceTabBody
        {...sharedProps}
        activeKind="details"
        activeTab={{ kind: "details" }}
      />,
    );

    expect(view.getByTestId("workspace-details-surface")).not.toHaveClass("hidden");
    expect(view.getByTestId("native-viewer-transition-shield")).toBeInTheDocument();
    await waitFor(() => expect(finishHide).not.toBeNull());

    act(() => finishHide?.());
    await waitFor(() => {
      expect(
        view.queryByTestId("native-viewer-transition-shield"),
      ).not.toBeInTheDocument();
    });
    view.unmount();
  });

});
