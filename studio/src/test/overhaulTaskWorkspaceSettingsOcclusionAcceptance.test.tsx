/**
 * Retained Task-workspace viewer occlusion (CODING-792).
 *
 * This is the mounted workspace seam missing from the shared Settings/native
 * coverage: the real footer action, Task tab selection, retained-viewer pool,
 * singleton modal host, and serialized native boundary all participate.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { StudioFooter } from "../app/shell/StudioFooter";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useAgentStatusStore } from "../features/agents/status";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import {
  INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS,
  configureNativeRenderRecovery,
  nativeRenderRecoveryPending,
  resetNativeRenderRecovery,
} from "../features/agents/terminal/internal/nativeRenderRecovery";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useStudioStore } from "../features/projects/store";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

const tauri = vi.hoisted(() => ({
  desktop: true,
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: () => tauri.desktop,
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

const settingsApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...settingsApi,
}));

const terminalApi = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  getTerminals: vi.fn(),
  listResumableTerminals: vi.fn(),
  resumeTerminal: vi.fn(),
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const HANDLE = "task-viewer-792";
const FRAME = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  viewportWidth: 800,
  viewportHeight: 600,
};

let hostRequests: string[] = [];

function invocations(command: string): unknown[][] {
  return tauri.invoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => call.slice(1));
}

function seedTaskWorkspace(sessionId: string, runId: string): void {
  useTerminalStore.setState({
    sessions: {
      [sessionId]: {
        sessionId,
        taskId: "task-792",
        projectId: "project-1",
        moduleId: "module-1",
        agent: "codex",
        status: "ready",
        transport: "ready",
        isPlanning: false,
        isInstant: false,
        initialPrompt: null,
        agentRunId: runId,
      },
    },
    sessionByRun: { [runId]: sessionId },
  });
  useAgentStatusStore.setState({
    runs: {
      [runId]: {
        agent_run_id: runId,
        task_id: "task-792",
        module_id: "module-1",
        scope: "task",
        state: "working",
        started_at: "2026-08-17T12:00:00Z",
        updated_at: "2026-08-17T12:00:00Z",
      },
    },
  });
  useClientStore.setState({
    activeByTask: { "task-792": sessionId },
    workspaces: {
      "task-792": {
        active: "terminal",
        activeDocId: null,
        closedDocIds: [],
      },
    },
  });
}

function mountTaskWorkspace() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SelectedTicketContent
        bucket="task-792"
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<div>Task details</div>}
      />
      <StudioFooter />
      <ModalHost />
    </QueryClientProvider>,
  );
}

describe("overhaul acceptance — Task workspace Settings occlusion", () => {
  const reload = vi.fn();
  let restoreNativeRenderRecovery: () => void;

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    queryClient.clear();
    hostRequests = [];
    tauri.desktop = true;
    restoreNativeRenderRecovery = configureNativeRenderRecovery({ reload });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        hostRequests.push(String(input));
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
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
    Object.defineProperty(window, "innerWidth", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 600,
      configurable: true,
    });

    seedConfig({ features: { sidebar: true, projects: true } });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({
      activeByTask: {},
      workspaces: {},
      sidebarVisible: true,
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });

    settingsApi.getLaunchProviderCapabilities.mockResolvedValue([]);
    settingsApi.getProviderCatalog.mockResolvedValue({
      value: {
        activated_providers: ["claude"],
        global_default: {
          provider: "claude",
          model: "sonnet",
          reasoning: "high",
        },
      },
    });
    terminalApi.getDocuments.mockResolvedValue({ documents: [] });
    terminalApi.getTerminals.mockResolvedValue([]);
    terminalApi.listResumableTerminals.mockResolvedValue([]);
    tauri.listen.mockResolvedValue(() => {});
    tauri.invoke.mockImplementation(
      (command: string, input?: { runId?: string }) => {
        if (command === "native_terminal_available") return Promise.resolve(true);
        if (
          command === "native_terminal_attach" ||
          command === "native_terminal_show" ||
          command === "native_terminal_set_frame" ||
          command === "native_terminal_reconcile_frame"
        ) {
          return Promise.resolve({
            handle: HANDLE,
            runId: input?.runId ?? "run-792",
            columns: 100,
            rows: 30,
          });
        }
        return Promise.resolve();
      },
    );
  });

  afterEach(() => {
    resetNativeRenderRecovery();
    restoreNativeRenderRecovery();
    vi.useRealTimers();
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    vi.unstubAllGlobals();
  });

  it("[overhaul-123] hides and restores the retained Task viewer through Settings while browser compatibility remains in the WebView", async () => {
    seedTaskWorkspace("session-792", "run-792");
    const nativeView = mountTaskWorkspace();

    expect(await screen.findByRole("tab", { name: "codex terminal" }))
      .toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(invocations("native_terminal_show")).toHaveLength(1),
    );
    const requestsBeforeSettings = hostRequests.length;

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    expect(dialog).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    ).toBeEnabled();
    await waitFor(() => {
      expect(invocations("native_terminal_hide")).toEqual([[{ handle: HANDLE }]]);
    });
    expect(invocations("native_terminal_detach")).toHaveLength(0);
    expect(invocations("native_terminal_attach")).toHaveLength(1);
    expect(hostRequests).toHaveLength(requestsBeforeSettings);
    expect(useTerminalStore.getState().sessions["session-792"]).toMatchObject({
      agentRunId: "run-792",
      status: "ready",
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() =>
      expect(invocations("native_terminal_show")).toHaveLength(2),
    );
    expect(invocations("native_terminal_show").at(-1)).toEqual([
      { handle: HANDLE, frame: FRAME },
    ]);
    expect(invocations("native_terminal_attach")).toHaveLength(1);
    expect(
      hostRequests.filter((url) =>
        url.endsWith("/api/terminals/viewers/lease"),
      ),
    ).toHaveLength(1);
    expect(hostRequests.some((url) => url.includes("/lease/release"))).toBe(false);

    nativeView.unmount();
    await waitFor(() =>
      expect(invocations("native_terminal_detach")).toHaveLength(1),
    );
    const nativeCommandCount = tauri.invoke.mock.calls.length;

    tauri.desktop = false;
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    seedTaskWorkspace("browser-session-792", "browser-run-792");
    const browserView = mountTaskWorkspace();
    const browserHost = await screen.findByTestId("terminal-host");

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    const browserDialog = await screen.findByRole("dialog", {
      name: "Studio settings",
    });
    expect(browserDialog).toBeVisible();
    expect(screen.getByTestId("terminal-host")).toBe(browserHost);
    expect(tauri.invoke.mock.calls).toHaveLength(nativeCommandCount);

    fireEvent.click(
      within(browserDialog).getByRole("button", { name: "Close dialog" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("terminal-host")).toBe(browserHost);
    expect(tauri.invoke.mock.calls).toHaveLength(nativeCommandCount);
    browserView.unmount();
  });

  it("[overhaul-146] keeps Settings mounted when its native viewer hide fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seedTaskWorkspace("session-857", "run-857");
    tauri.invoke.mockImplementation(
      (command: string, input?: { runId?: string }) => {
        if (command === "native_terminal_available") return Promise.resolve(true);
        if (command === "native_terminal_hide") {
          return Promise.reject(new Error("native terminal hide failed"));
        }
        if (
          command === "native_terminal_attach" ||
          command === "native_terminal_show" ||
          command === "native_terminal_set_frame" ||
          command === "native_terminal_reconcile_frame"
        ) {
          return Promise.resolve({
            handle: HANDLE,
            runId: input?.runId ?? "run-857",
            columns: 100,
            rows: 30,
          });
        }
        return Promise.resolve();
      },
    );

    const view = mountTaskWorkspace();
    await waitFor(() =>
      expect(invocations("native_terminal_show")).toHaveLength(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    await waitFor(() =>
      expect(screen.getByTestId("native-terminal-fallback-notice")).toBeVisible(),
    );

    expect(dialog).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    ).toBeEnabled();
    expect(nativeRenderRecoveryPending()).toBe(false);

    await vi.advanceTimersByTimeAsync(
      INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS + 200,
    );
    expect(reload).not.toHaveBeenCalled();
    expect(dialog).toBeVisible();

    view.unmount();
  });

  it("[overhaul-124] shields a newer Task destination until Settings' pending native hide commits", async () => {
    seedTaskWorkspace("session-792", "run-792");
    let finishHide: (() => void) | null = null;
    const pendingHide = new Promise<void>((resolve) => {
      finishHide = resolve;
    });
    tauri.invoke.mockImplementation(
      (command: string, input?: { runId?: string }) => {
        if (command === "native_terminal_available") return Promise.resolve(true);
        if (
          command === "native_terminal_attach" ||
          command === "native_terminal_show" ||
          command === "native_terminal_set_frame" ||
          command === "native_terminal_reconcile_frame"
        ) {
          return Promise.resolve({
            handle: HANDLE,
            runId: input?.runId ?? "run-792",
            columns: 100,
            rows: 30,
          });
        }
        if (command === "native_terminal_hide") {
          return pendingHide;
        }
        return Promise.resolve();
      },
    );
    const view = mountTaskWorkspace();
    await waitFor(() =>
      expect(invocations("native_terminal_show")).toHaveLength(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    await waitFor(() => expect(finishHide).not.toBeNull());

    // Navigation intent can change underneath a window-level modal (for
    // example from a Work-item selection or another Studio surface).
    act(() => useClientStore.getState().setActive("task-792", "details"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.getByText("Task details")).toBeVisible());

    // Settings no longer covers the native island, so the Task workspace owns
    // a shield until the already-issued hide makes Details safe to expose.
    expect(screen.getByTestId("native-viewer-transition-shield")).toBeVisible();
    expect(invocations("native_terminal_show")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    const reopenedDialog = await screen.findByRole("dialog", {
      name: "Studio settings",
    });
    const closeControl = within(reopenedDialog).getByRole("button", {
      name: "Close dialog",
    });
    expect(reopenedDialog).toBeVisible();
    expect(closeControl).toBeVisible();
    expect(closeControl).toBeEnabled();
    expect(
      screen.queryByTestId("native-viewer-transition-shield"),
    ).not.toBeInTheDocument();

    fireEvent.click(closeControl);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("native-viewer-transition-shield")).toBeVisible();

    await act(async () => finishHide?.());
    await waitFor(() =>
      expect(
        screen.queryByTestId("native-viewer-transition-shield"),
      ).not.toBeInTheDocument(),
    );
    expect(invocations("native_terminal_show")).toHaveLength(1);

    view.unmount();
  });

  it("[overhaul-126] hides and restores the retained Task viewer through state configuration", async () => {
    seedTaskWorkspace("session-792", "run-792");
    const view = mountTaskWorkspace();
    await waitFor(() =>
      expect(invocations("native_terminal_show")).toHaveLength(1),
    );

    act(() =>
      useClientStore
        .getState()
        .toggleStateConfiguration("project-1", "state-1"),
    );
    await waitFor(() =>
      expect(invocations("native_terminal_hide")).toEqual([[{ handle: HANDLE }]]),
    );
    expect(invocations("native_terminal_detach")).toHaveLength(0);

    act(() => useClientStore.getState().dismissStateConfiguration());
    await waitFor(() =>
      expect(invocations("native_terminal_show")).toHaveLength(2),
    );
    expect(invocations("native_terminal_show").at(-1)).toEqual([
      { handle: HANDLE, frame: FRAME },
    ]);
    expect(invocations("native_terminal_attach")).toHaveLength(1);

    view.unmount();
  });

  it("suppresses an older same-handle reveal across a close-reopen-close Settings sequence", async () => {
    seedTaskWorkspace("session-792", "run-792");
    let deferShows = false;
    const finishShows: Array<() => void> = [];
    tauri.invoke.mockImplementation(
      (command: string, input?: { runId?: string }) => {
        if (command === "native_terminal_available") return Promise.resolve(true);
        if (
          command === "native_terminal_attach" ||
          command === "native_terminal_set_frame" ||
          command === "native_terminal_reconcile_frame"
        ) {
          return Promise.resolve({
            handle: HANDLE,
            runId: input?.runId ?? "run-792",
            columns: 100,
            rows: 30,
          });
        }
        if (command === "native_terminal_show") {
          const status = {
            handle: HANDLE,
            runId: "run-792",
            columns: 100,
            rows: 30,
          };
          if (!deferShows) return Promise.resolve(status);
          return new Promise<typeof status>((resolve) => {
            finishShows.push(() => resolve(status));
          });
        }
        return Promise.resolve();
      },
    );
    const view = mountTaskWorkspace();
    await waitFor(() =>
      expect(invocations("native_terminal_show")).toHaveLength(1),
    );

    let dialog = await (async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
      return screen.findByRole("dialog", { name: "Studio settings" });
    })();
    await waitFor(() =>
      expect(invocations("native_terminal_hide")).toHaveLength(1),
    );

    deferShows = true;
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(finishShows).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));

    // The first reveal now completes under a newer request for the same native
    // handle. Handle equality is not enough: it must be hidden before the
    // newest reveal can commit its current geometry and focus policy.
    await act(async () => finishShows.shift()?.());
    await waitFor(() =>
      expect(invocations("native_terminal_hide")).toHaveLength(2),
    );
    await waitFor(() => expect(finishShows).toHaveLength(1));

    await act(async () => finishShows.shift()?.());
    await waitFor(() =>
      expect(invocations("native_terminal_show")).toHaveLength(3),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    view.unmount();
  });
});
