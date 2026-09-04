import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SelectedTicketTerminal } from "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

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
    window.history.replaceState({}, "", "/?terminalRenderer=native");
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

  it("[overhaul-69] transfers one retained viewer between Studio and drawer without transferring focus authority", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    let drawerLeft = 420;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const left = this.closest('[data-native-surface="drawer"]')
          ? drawerLeft
          : 20;
        return {
          x: left,
          y: 40,
          top: 40,
          left,
          right: left + 360,
          bottom: 280,
          width: 360,
          height: 240,
          toJSON: () => ({}),
        };
      },
    );
    useClientStore.setState({ activeByTask: { "task-1": "session-1" } });

    const hosts = ({
      drawer,
      drawerActive = true,
      drawerFocus = 0,
      studioFocus = 0,
    }: {
      drawer: boolean;
      drawerActive?: boolean;
      drawerFocus?: number;
      studioFocus?: number;
    }) => (
      <>
        <div data-native-surface="studio">
          <SelectedTicketTerminal
            bucket="task-1"
            owner="studio"
            focusSignal={studioFocus}
          />
        </div>
        {drawer ? (
          <div data-native-surface="drawer">
            <SelectedTicketTerminal
              bucket="task-1"
              owner="drawer"
              active={drawerActive}
              focusSignal={drawerFocus}
            />
          </div>
        ) : null}
      </>
    );

    const view = render(hosts({ drawer: true }));
    const calls = (command: string) =>
      tauri.invoke.mock.calls.filter(([name]) => name === command);

    await waitFor(() => expect(calls("native_terminal_attach")).toHaveLength(1));
    await waitFor(() => {
      expect(calls("native_terminal_show")).toContainEqual([
        "native_terminal_show",
        expect.objectContaining({
          handle: "native-1",
          frame: expect.objectContaining({ x: 420, width: 360, height: 240 }),
        }),
      ]);
    });
    expect(calls("native_terminal_focus")).toHaveLength(0);
    expect(calls("native_terminal_detach")).toHaveLength(0);

    view.rerender(hosts({ drawer: true, drawerFocus: 1, studioFocus: 1 }));
    await waitFor(() => expect(calls("native_terminal_focus")).toHaveLength(1));

    view.rerender(
      hosts({ drawer: true, drawerActive: false, drawerFocus: 2 }),
    );
    await waitFor(() => expect(calls("native_terminal_hide").length).toBeGreaterThan(0));
    expect(calls("native_terminal_focus")).toHaveLength(1);
    const drawerViewer = view.container.querySelector(
      '[data-native-surface="drawer"] [data-testid="retained-terminal-viewer"]',
    );
    expect(drawerViewer).toHaveClass("invisible", "pointer-events-none");

    drawerLeft = 300;
    view.rerender(hosts({ drawer: true, drawerFocus: 0 }));
    await waitFor(() => {
      expect(calls("native_terminal_show")).toContainEqual([
        "native_terminal_show",
        expect.objectContaining({
          frame: expect.objectContaining({ x: 300, width: 360, height: 240 }),
        }),
      ]);
    });
    expect(calls("native_terminal_focus")).toHaveLength(1);

    view.rerender(hosts({ drawer: true, drawerFocus: 3 }));
    await waitFor(() => expect(calls("native_terminal_focus")).toHaveLength(2));

    view.rerender(hosts({ drawer: false, studioFocus: 0 }));
    await waitFor(() => {
      expect(calls("native_terminal_show")).toContainEqual([
        "native_terminal_show",
        expect.objectContaining({
          frame: expect.objectContaining({ x: 20, width: 360, height: 240 }),
        }),
      ]);
    });
    expect(calls("native_terminal_attach")).toHaveLength(1);
    expect(calls("native_terminal_detach")).toHaveLength(0);
    expect(calls("native_terminal_focus")).toHaveLength(2);
  });

  it("[overhaul-71] keeps the pooled lifecycle when the first host leaves after ownership transfers", async () => {
    // Viewer ownership is claimed and released on the Rust lease contract, so
    // what a test counts is lease operations, not host requests.
    const leaseOperations = installDesktopGraphQlRuntime();
    const leases = (operationName: string) =>
      leaseOperations.filter((operation) => operation.operationName === operationName);
    const unlisten = vi.fn();
    tauri.listen.mockResolvedValue(unlisten);
    useClientStore.setState({ activeByTask: { "task-1": "session-1" } });

    const drawer = (
      <div key="drawer" data-native-surface="drawer">
        <SelectedTicketTerminal bucket="task-1" owner="drawer" />
      </div>
    );
    const studio = (
      <div key="studio" data-native-surface="studio">
        <SelectedTicketTerminal bucket="task-1" owner="studio" />
      </div>
    );
    const calls = (command: string) =>
      tauri.invoke.mock.calls.filter(([name]) => name === command);

    const view = render(<>{drawer}</>);
    await waitFor(() => expect(calls("native_terminal_attach")).toHaveLength(1));

    view.rerender(<>{drawer}{studio}</>);
    await waitFor(() => {
      expect(view.container.querySelector(
        '[data-native-surface="studio"] [data-testid="native-terminal-host"]',
      )).not.toBeNull();
    });
    view.rerender(<>{studio}</>);
    await waitFor(() => {
      expect(view.queryByText("View here")).not.toBeInTheDocument();
    });
    expect(calls("native_terminal_attach")).toHaveLength(1);
    expect(calls("native_terminal_detach")).toHaveLength(0);
    expect(unlisten).not.toHaveBeenCalled();
    expect(leases("CreateViewerLease")).toHaveLength(1);
    expect(leases("DeleteViewerLease")).toHaveLength(0);

    view.unmount();
    await waitFor(() => expect(calls("native_terminal_detach")).toHaveLength(1));
    expect(leases("DeleteViewerLease")).toHaveLength(1);
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

});
