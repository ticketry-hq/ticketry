/**
 * The module App run as a person sees it: one footer action, one distinct
 * panel segment, and one durable process identity (#1101).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { StudioFooter } from "../app/shell/StudioFooter";
import { AppRunPanel } from "../features/app-run/AppRunPanel";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useStudioStore } from "../features/projects/store";
import { seedConfig } from "../features/studio/stores/configStore";
import { useModuleShellStore } from "../features/terminal-panel/moduleShellStore";
import { useTerminalPanelStore } from "../features/terminal-panel/panelStore";
import { TerminalPanel } from "../features/terminal-panel/TerminalPanel";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

const appRunApi = vi.hoisted(() => ({
  startAppRun: vi.fn(),
  stopAppRun: vi.fn(),
  saveRunConfiguration: vi.fn(),
}));

const runState = vi.hoisted(() => ({
  configuration: null as null | {
    module_id: string;
    command: string;
    environment: Record<string, string>;
    preview_url: string | null;
    created_at: string;
    updated_at: string;
  },
  live: false,
  runId: null as string | null,
  loading: false,
  refetch: vi.fn(async () => undefined),
}));

vi.mock("../features/app-run/api/appRunApi", () => appRunApi);
vi.mock("../features/app-run/useModuleAppRun", () => ({
  useModuleAppRun: () => runState,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ columns: 80, rows: 24 }),
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../features/agents/terminal/internal/entryPool", () => ({
  getEntry: () => ({
    term: { open: () => {}, focus: () => {}, cols: 80, rows: 24 },
    fit: { fit: () => {}, proposeDimensions: () => ({ cols: 80, rows: 24 }) },
    lastCols: 80,
    lastRows: 24,
    ws: null,
    agentRunId: null,
  }),
  ensureConnected: () => {},
  notifyForeground: () => {},
  notifyBackground: () => {},
  rememberTerminalGeometry: () => {},
  registerPoolDriver: () => () => {},
  releasePooledTransport: () => {},
  syncEntries: () => {},
}));

const configured = {
  module_id: "module-1",
  command: "npm run dev",
  environment: { PORT: "5174" },
  preview_url: "http://127.0.0.1:5174",
  created_at: "2026-08-27T00:00:00Z",
  updated_at: "2026-08-27T00:00:00Z",
};

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function renderWorkspace() {
  return render(
    <>
      <TerminalPanel />
      <StudioFooter />
      <ModalHost />
    </>,
  );
}

describe("module App run acceptance", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    installDesktopGraphQlRuntime();
    appRunApi.startAppRun.mockReset();
    appRunApi.startAppRun.mockResolvedValue({ runId: "app-run-module-1" });
    appRunApi.stopAppRun.mockReset();
    appRunApi.stopAppRun.mockResolvedValue(undefined);
    appRunApi.saveRunConfiguration.mockReset();
    appRunApi.saveRunConfiguration.mockResolvedValue(undefined);
    runState.configuration = null;
    runState.live = false;
    runState.runId = null;
    runState.loading = false;
    runState.refetch.mockClear();
    useClientStore.setState({
      selectedModuleId: "module-1",
      editViewZone: "active-tab-body",
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useModuleShellStore.setState({ byModule: {} });
    useTerminalPanelStore.setState({
      openModules: {},
      activeSegmentByModule: {},
      focusSignal: 0,
    });
    seedConfig({
      profiles: [
        {
          name: "local",
          workspace_slug: "ticketry",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [{ module_id: "module-1", path: "/repo/module-1" }],
          recent_project_id: "project-1",
        },
      ],
      recentProfileIndex: 0,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("[overhaul-173] teaches first use by opening Run configuration", async () => {
    renderWorkspace();

    fireEvent.click(screen.getByTestId("footer-run-primary"));

    expect(
      await screen.findByRole("dialog", { name: "Run configuration" }),
    ).toBeTruthy();
    expect(screen.getByTestId("run-configuration-command")).toBeTruthy();
    expect(appRunApi.startAppRun).not.toHaveBeenCalled();
  });

  it("[overhaul-174] starts a configured app and opens its panel segment", async () => {
    runState.configuration = configured;
    renderWorkspace();

    fireEvent.click(screen.getByTestId("footer-run-primary"));

    await waitFor(() => expect(appRunApi.startAppRun).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("terminal-panel")).toBeTruthy();
    expect(
      screen.getByTestId("terminal-panel-app-run-segment").getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByTestId("app-run-not-running")).toBeTruthy();
  });

  it("[overhaul-175] focuses a live app without starting a duplicate", () => {
    runState.configuration = configured;
    runState.live = true;
    runState.runId = "app-run-module-1";
    renderWorkspace();

    fireEvent.click(screen.getByTestId("footer-run-primary"));

    expect(appRunApi.startAppRun).not.toHaveBeenCalled();
    expect(screen.getByTestId("footer-run-primary").textContent).toContain("Running");
    expect(screen.getByTestId("terminal-panel-app-run-segment")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("[overhaul-176] exposes Stop only while the app is live", async () => {
    runState.configuration = configured;
    runState.live = true;
    runState.runId = "app-run-module-1";
    const view = renderWorkspace();

    fireEvent.click(screen.getByTestId("footer-run-stop"));
    await waitFor(() => expect(appRunApi.stopAppRun).toHaveBeenCalledTimes(1));

    act(() => {
      runState.live = false;
      runState.runId = null;
    });
    view.rerender(
      <>
        <TerminalPanel />
        <StudioFooter />
        <ModalHost />
      </>,
    );
    expect(screen.queryByTestId("footer-run-stop")).toBeNull();
  });

  it("[overhaul-177] explains a missing module folder without hiding configuration", () => {
    seedConfig({
      profiles: [
        {
          name: "local",
          workspace_slug: "ticketry",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [],
          recent_project_id: "project-1",
        },
      ],
    });
    renderWorkspace();

    expect(screen.getByTestId("footer-run-primary")).toBeDisabled();
    expect(screen.getByTestId("footer-run-primary")).toHaveAttribute(
      "title",
      "Choose a module folder before running this app",
    );
    expect(screen.getByTestId("footer-run-configure")).toBeEnabled();
  });

  it("[overhaul-178] shows the preview link only for a live App run", () => {
    runState.configuration = configured;
    runState.live = true;
    runState.runId = "app-run-module-1";
    const view = render(<AppRunPanel moduleId="module-1" />);

    expect(screen.getByRole("link", { name: configured.preview_url })).toHaveAttribute(
      "href",
      configured.preview_url,
    );

    act(() => {
      runState.live = false;
    });
    view.rerender(<AppRunPanel moduleId="module-1" />);
    expect(screen.queryByTestId("app-run-preview-link")).toBeNull();
  });

  it("[overhaul-179] gives Run and Terminal the same module availability", () => {
    act(() => useClientStore.setState({ selectedModuleId: null }));
    const view = render(<StudioFooter />);
    expect(screen.getByTestId("footer-run-primary")).toBeDisabled();
    expect(screen.getByTestId("footer-terminal-toggle")).toBeDisabled();

    act(() => useClientStore.setState({ selectedModuleId: "module-1" }));
    view.rerender(<StudioFooter />);
    expect(screen.getByTestId("footer-run-primary")).toBeEnabled();
    expect(screen.getByTestId("footer-terminal-toggle")).toBeEnabled();
  });

  it("[overhaul-180] keeps App runs out of the shell tab strip", () => {
    useTerminalPanelStore.getState().showAppRun("module-1");
    render(<TerminalPanel />);

    expect(screen.getByTestId("terminal-panel-app-run-segment")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByTestId("terminal-panel-tab")).toBeNull();
  });
});
