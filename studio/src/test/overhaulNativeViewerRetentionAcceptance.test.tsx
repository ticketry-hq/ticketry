import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SelectedTicketTerminal } from "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal";
import {
  RETAINED_TERMINAL_VIEW_LIMIT,
  RetainedTerminalViewers,
} from "../features/agents/terminal/RetainedTerminalViewers";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";
import {
  grantsEveryLease,
  installDesktopGraphQlRuntime,
  type RecordedGraphQlOperation,
} from "./desktopGraphQlRuntime";
import { documentOperationName } from "../graphql-foundation/typedDocument";

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

function MountedSelectedTicketTerminal() {
  const selectedTaskId = useClientStore((state) => state.selectedTaskId);
  return selectedTaskId ? (
    <SelectedTicketTerminal bucket={selectedTaskId} active owner="studio" />
  ) : null;
}

describe("native viewer attachment acceptance", () => {
  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/?terminalRenderer=native");
    vi.resetAllMocks();
    localStorage.setItem("ticketry:terminal-renderer", "native");
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

  it("[overhaul-67] retains opened native viewers across Work items and terminal tabs", async () => {
    const leaseOperations: RecordedGraphQlOperation[] = [];
    const leases = (operationName: string) =>
      leaseOperations.filter((operation) => operation.operationName === operationName);
    useTerminalStore.setState({
      sessions: {
        "session-1": useTerminalStore.getState().sessions["session-1"],
        "session-2": {
          ...useTerminalStore.getState().sessions["session-1"],
          sessionId: "session-2",
          taskId: "task-2",
          agentRunId: "run-2",
        },
        "session-3": {
          ...useTerminalStore.getState().sessions["session-1"],
          sessionId: "session-3",
          agentRunId: "run-3",
        },
      },
      sessionByRun: {
        "run-1": "session-1",
        "run-2": "session-2",
        "run-3": "session-3",
      },
    });
    useClientStore.setState({
      activeByTask: {
        "task-1": "session-1",
        "task-2": "session-2",
      },
    });
    let delayRunThreeShow = false;
    let finishRunThreeShow: (() => void) | null = null;
    tauri.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (command === "native_terminal_attach") {
        const runId = String(args?.runId);
        return Promise.resolve({
          handle: `native-${runId}`,
          runId,
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_show") {
        const status = {
          handle: String(args?.handle),
          runId: String(args?.handle).replace("native-", ""),
          columns: 100,
          rows: 30,
        };
        if (delayRunThreeShow && args?.handle === "native-run-3") {
          return new Promise((resolve) => {
            finishRunThreeShow = () => resolve(status);
          });
        }
        return Promise.resolve(status);
      }
      return Promise.resolve();
    });

    const http = fixture();
    http.tree("module-1", {
      rootIds: ["task-1", "task-2"],
      children: { "task-1": [], "task-2": [] },
      order: ["task-1", "task-2"],
    });
    http.workItems([
      workItem({ id: "task-1", name: "Work item one", rank: "A" }),
      workItem({
        id: "task-2",
        name: "Work item two",
        key: "MEML-2",
        sequence_id: 2,
        rank: "B",
      }),
    ]);
    mountStudio({
      http,
      selectedTaskId: "task-1",
      children: <MountedSelectedTicketTerminal />,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document).endsWith("ViewerLease")) {
          leaseOperations.push({ operationName: documentOperationName(document), variables });
          return grantsEveryLease(document, variables);
        }
        return http.executeGraphQl(document, variables);
      },
    });
    const attachRuns = () => tauri.invoke.mock.calls
      .filter(([command]) => command === "native_terminal_attach")
      .map(([, args]) => (args as { runId: string }).runId);

    await waitFor(() => expect(attachRuns()).toEqual(["run-1"]));
    expect(attachRuns()).not.toContain("run-3");

    fireEvent.click(await screen.findByRole("treeitem", { name: /Work item two/ }));
    await waitFor(() => expect(attachRuns()).toEqual(["run-1", "run-2"]));
    expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_hide", {
      handle: "native-run-1",
    });

    fireEvent.click(screen.getByRole("treeitem", { name: /Work item one/ }));
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith(
        "native_terminal_show",
        expect.objectContaining({ handle: "native-run-1" }),
      );
    });

    const runOneShowsBeforeReturn = tauri.invoke.mock.calls.filter(
      ([command, args]) => command === "native_terminal_show" &&
        (args as { handle?: string })?.handle === "native-run-1",
    ).length;
    act(() => {
      useClientStore.setState({
        activeByTask: {
          ...useClientStore.getState().activeByTask,
          "task-1": "session-3",
        },
      });
    });
    await waitFor(() => {
      expect(attachRuns()).toEqual(["run-1", "run-2", "run-3"]);
    });

    act(() => {
      useClientStore.setState({
        activeByTask: {
          ...useClientStore.getState().activeByTask,
          "task-1": "session-1",
        },
      });
    });
    await waitFor(() => {
      expect(tauri.invoke.mock.calls.filter(
        ([command, args]) => command === "native_terminal_show" &&
          (args as { handle?: string })?.handle === "native-run-1",
      )).toHaveLength(runOneShowsBeforeReturn + 1);
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_hide", {
        handle: "native-run-3",
      });
    });

    delayRunThreeShow = true;
    act(() => {
      useClientStore.setState({
        activeByTask: {
          ...useClientStore.getState().activeByTask,
          "task-1": "session-3",
        },
      });
    });
    await waitFor(() => expect(finishRunThreeShow).not.toBeNull());
    act(() => {
      useClientStore.setState({
        activeByTask: {
          ...useClientStore.getState().activeByTask,
          "task-1": "session-1",
        },
      });
      finishRunThreeShow?.();
    });
    await waitFor(() => {
      const visibility = tauri.invoke.mock.calls.filter(([command]) =>
        command === "native_terminal_hide" || command === "native_terminal_show"
      );
      const lastIndex = (
        predicate: (call: unknown[]) => boolean,
      ): number => {
        for (let index = visibility.length - 1; index >= 0; index -= 1) {
          if (predicate(visibility[index])) return index;
        }
        return -1;
      };
      const staleShow = lastIndex(([command, args]) =>
        command === "native_terminal_show" &&
        (args as { handle?: string })?.handle === "native-run-3"
      );
      const staleHide = lastIndex(([command, args]) =>
        command === "native_terminal_hide" &&
        (args as { handle?: string })?.handle === "native-run-3"
      );
      const activeShow = lastIndex(([command, args]) =>
        command === "native_terminal_show" &&
        (args as { handle?: string })?.handle === "native-run-1"
      );
      expect(staleHide).toBeGreaterThan(staleShow);
      expect(activeShow).toBeGreaterThan(staleShow);
    });

    expect(attachRuns()).toEqual(["run-1", "run-2", "run-3"]);
    expect(tauri.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_detach"
    )).toHaveLength(0);
    expect(leases("CreateViewerLease")).toHaveLength(3);
    expect(leases("DeleteViewerLease")).toHaveLength(0);
  });

  it("[overhaul-235] evicts the least recently viewed native terminal when the measured total-view limit is reached", async () => {
    expect(RETAINED_TERMINAL_VIEW_LIMIT).toBe(20);
    installDesktopGraphQlRuntime();
    const baseSession = useTerminalStore.getState().sessions["session-1"];
    useTerminalStore.setState({
      sessions: {
        "session-1": baseSession,
        "session-2": {
          ...baseSession,
          sessionId: "session-2",
          taskId: "task-2",
          agentRunId: "run-2",
        },
        "session-3": {
          ...baseSession,
          sessionId: "session-3",
          taskId: "task-3",
          agentRunId: "run-3",
        },
      },
      sessionByRun: {
        "run-1": "session-1",
        "run-2": "session-2",
        "run-3": "session-3",
      },
    });
    useClientStore.setState({
      activeByTask: {
        "task-1": "session-1",
        "task-2": "session-2",
        "task-3": "session-3",
      },
    });
    tauri.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (command === "native_terminal_attach") {
        const runId = String(args?.runId);
        return Promise.resolve({
          handle: `native-${runId}`,
          runId,
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_show") {
        return Promise.resolve({
          handle: String(args?.handle),
          runId: String(args?.handle).replace("native-", ""),
          columns: 100,
          rows: 30,
        });
      }
      return Promise.resolve();
    });

    const viewers = (bucket: string) => (
      <RetainedTerminalViewers
        bucket={bucket}
        owner="studio"
        focusSignal={0}
        active
        retentionLimit={2}
      />
    );
    const view = render(viewers("task-1"));
    const attachedRuns = () => tauri.invoke.mock.calls
      .filter(([command]) => command === "native_terminal_attach")
      .map(([, args]) => (args as { runId: string }).runId);
    const detachedHandles = () => tauri.invoke.mock.calls
      .filter(([command]) => command === "native_terminal_detach")
      .map(([, args]) => (args as { handle: string }).handle);

    await waitFor(() => expect(attachedRuns()).toEqual(["run-1"]));
    view.rerender(viewers("task-2"));
    await waitFor(() => expect(attachedRuns()).toEqual(["run-1", "run-2"]));

    // Revisiting run 1 makes run 2 the least recently viewed warm entry.
    view.rerender(viewers("task-1"));
    view.rerender(viewers("task-3"));
    await waitFor(() => {
      expect(attachedRuns()).toEqual(["run-1", "run-2", "run-3"]);
      expect(detachedHandles()).toContain("native-run-2");
    });
    expect(detachedHandles()).not.toContain("native-run-1");
    expect(screen.getAllByTestId("retained-terminal-viewer")).toHaveLength(2);
  });

});
