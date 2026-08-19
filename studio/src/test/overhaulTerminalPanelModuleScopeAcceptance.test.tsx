/**
 * Whether the terminal panel is showing belongs to the module, not the window
 * (#730).
 *
 * A module is a repository a person works in, and whether that work wants a
 * shell in front of it is a property of the repository rather than of the
 * window: a module being driven by an agent wants the panel shut, while the one
 * a dev server runs in wants it open. Carrying one flag across every module made
 * a switch either bury the terminal someone was using or shove one in front of
 * someone who never asked for it.
 *
 * What a person observes is that opening the panel in one module leaves another
 * module's alone, that a switch returns each module to its own state, and that a
 * restart brings all of that back. Height stays with the window, so it is the
 * one piece of the panel a module switch never moves.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  getTasks: vi.fn(),
  putProfile: vi.fn(),
}));

import { StudioFooter } from "../app/shell/StudioFooter";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useStudioStore } from "../features/projects/store";
import {
  getConfigSnapshot,
  seedConfig,
} from "../features/studio/stores/configStore";
import { useModuleShellStore } from "../features/terminal-panel/moduleShellStore";
import { PANEL_OPEN_KEY } from "../features/terminal-panel/panelOpenMemory";
import { useTerminalPanelStore } from "../features/terminal-panel/panelStore";
import { TerminalPanel } from "../features/terminal-panel/TerminalPanel";
import * as api from "../shared/api/client";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";
import { TERMINAL_PANEL_KEY } from "../state/persistence";

const runtime = vi.hoisted(() => ({ desktop: false, nativeAvailable: false }));

const shellApi = vi.hoisted(() => ({
  createModuleShell: vi.fn(),
  listModuleShells: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ columns: 80, rows: 24 }),
  isTauri: () => runtime.desktop,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock(
  "../features/agents/terminal/internal/nativeGhosttyAvailability",
  () => ({ nativeGhosttyAvailable: async () => runtime.nativeAvailable }),
);

vi.mock(
  "../features/terminal-panel/api/moduleShellApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../features/terminal-panel/api/moduleShellApi")
    >()),
    ...shellApi,
  }),
);

const getTasks = api.getTasks as ReturnType<typeof vi.fn>;
const putProfile = api.putProfile as ReturnType<typeof vi.fn>;

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function KeymapHarness() {
  useGlobalKeymap();
  return null;
}

function pressTogglePanel(): void {
  act(() => {
    fireEvent.keyDown(window, { key: "`", ctrlKey: true });
  });
}

/** Switches modules the way the module list does, action and all. */
async function switchModule(moduleId: string): Promise<void> {
  await act(async () => {
    await useClientStore.getState().selectModule(moduleId);
  });
}

function panelShowing(): boolean {
  return screen.queryByTestId("terminal-panel") !== null;
}

function footerToggle(): HTMLElement {
  return screen.getByTestId("footer-terminal-toggle");
}

function persistedOpenByModule(): Record<string, boolean> | null {
  const raw = localStorage.getItem(PANEL_OPEN_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, boolean>);
}

function persistedFurniture(): Record<string, unknown> | null {
  const raw = localStorage.getItem(TERMINAL_PANEL_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

describe("terminal panel module scope acceptance", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    runtime.desktop = false;
    runtime.nativeAvailable = false;
    getTasks.mockReset().mockResolvedValue({
      rootIds: [],
      children: {},
      order: [],
      states: [],
      workItems: [],
    });
    putProfile.mockReset().mockImplementation(async (_index, profile) => ({
      recent_profile_index: 0,
      features: getConfigSnapshot().features,
      profiles: [profile],
    }));
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    shellApi.createModuleShell.mockReset();
    // A launch that never settles keeps this case about which module the panel
    // belongs to: no terminal mounts, so nothing but the toggle moves it.
    shellApi.createModuleShell.mockReturnValue(new Promise(() => {}));
    shellApi.listModuleShells.mockReset();
    shellApi.listModuleShells.mockResolvedValue([]);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useTerminalPanelStore.setState({
      openModules: {},
      height: 280,
      focusSignal: 0,
    });
    useModuleShellStore.setState({ byModule: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({
      selectedModuleId: "module-1",
      sidebarVisible: false,
      editViewZone: "active-tab-body",
      editViewBodyEngaged: false,
      modalStack: [],
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    seedConfig({
      profiles: [
        {
          name: "local",
          workspace_slug: "meml",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [
            { module_id: "module-1", path: "/repo/module-1" },
            { module_id: "module-2", path: "/repo/module-2" },
          ],
          recent_project_id: "project-1",
        },
      ],
      recentProfileIndex: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("[overhaul-120] keeps the panel's open state with the module across a switch and a restart", async () => {
    render(
      <>
        <KeymapHarness />
        <TerminalPanel />
        <StudioFooter />
      </>,
    );

    // Opening in the module being worked in. The panel is that module's fourth
    // navigation zone while it shows.
    pressTogglePanel();
    expect(panelShowing()).toBe(true);
    expect(useClientStore.getState().editViewZone).toBe("terminal-panel");

    // Moving to a module that never asked for a shell arrives without one, and
    // the zone cycle lands where a module switch always leaves it rather than
    // pointing at a surface that is gone.
    await switchModule("module-2");
    expect(panelShowing()).toBe(false);
    expect(useClientStore.getState().editViewZone).toBe("stories");
    expect(footerToggle().getAttribute("aria-label")).toBe(
      "Open terminal panel",
    );

    // Each module answers for itself: opening here, then shutting it again,
    // says nothing about the module left behind.
    pressTogglePanel();
    expect(panelShowing()).toBe(true);
    pressTogglePanel();
    expect(panelShowing()).toBe(false);

    await switchModule("module-1");
    expect(panelShowing()).toBe(true);
    expect(footerToggle().getAttribute("aria-label")).toBe(
      "Minimize terminal panel",
    );

    // One module-keyed record holds the answers, and the window's own furniture
    // is untouched by any of it — height never moved, so nothing was written.
    await waitFor(() =>
      expect(persistedOpenByModule()).toEqual({
        "module-1": true,
        "module-2": false,
      }),
    );
    expect(persistedFurniture()).toBeNull();

    // A restart reads that record back, each module to its own state, before
    // anyone touches a key.
    vi.resetModules();
    const restarted = await import(
      "../features/terminal-panel/panelStore"
    );
    expect(restarted.isTerminalPanelOpenIn("module-1")).toBe(true);
    expect(restarted.isTerminalPanelOpenIn("module-2")).toBe(false);
  });
});
