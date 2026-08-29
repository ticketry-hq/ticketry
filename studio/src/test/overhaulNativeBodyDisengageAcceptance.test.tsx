import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NATIVE_TERMINAL_CHORD_EVENT } from "../app/navigation/nativeTerminalChords";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useModalStore } from "../app/modal/modalStore";
import { useNativeViewerKeyboardOwnership } from "../features/agents/terminal/internal/useNativeViewerHostEffects";
import {
  isTerminalPanelOpenIn,
  useTerminalPanelStore,
} from "../features/terminal-panel";
import { useClientStore } from "../state/clientStore";

const host = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    listeners,
    listen: vi.fn(async (event: string, handler: (event: unknown) => void) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    }),
    reportBodyDisengage: (handle: string, runId: string) =>
      listeners.get(NATIVE_TERMINAL_CHORD_EVENT)?.({
        payload: { handle, runId, chord: "body-disengage" },
      }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: host.listen }));

interface ViewerOwnership {
  runId: string | null;
  handle: string | null;
  presented: boolean;
  visible: boolean;
  modalOpen: boolean;
}

function useBodyDisengageHarness(ownership: ViewerOwnership): void {
  useGlobalKeymap();
  useNativeViewerKeyboardOwnership(ownership);
}

const originalSetEditViewBodyEngaged =
  useClientStore.getState().setEditViewBodyEngaged;

describe("native Cmd+Escape body disengagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    host.listeners.clear();
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useTerminalPanelStore.setState({ openModules: { "module-1": true } });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: "task-1",
      sidebarVisible: false,
      editViewZone: "terminal-panel",
      editViewBodyEngaged: true,
      navigationModality: "pointer",
      workspaces: {
        "task-1": {
          active: "doc",
          activeDocId: "doc-1",
          closedDocIds: [],
        },
      },
      activeByTask: { "task-1": "session-1" },
      setEditViewBodyEngaged: originalSetEditViewBodyEngaged,
    });
  });

  afterEach(() => {
    useClientStore.setState({
      setEditViewBodyEngaged: originalSetEditViewBodyEngaged,
    });
  });

  it("[overhaul-180] converges native and WebView Cmd+Escape without closing or changing selection", async () => {
    const zone = render(
      <button data-navigation-zone="terminal-panel">Terminal panel</button>,
    ).getByRole("button", { name: "Terminal panel" });
    const focusZone = vi.spyOn(zone, "focus");
    const setBodyEngaged = vi.fn(originalSetEditViewBodyEngaged);
    useClientStore.setState({ setEditViewBodyEngaged: setBodyEngaged });
    const harness = renderHook(useBodyDisengageHarness, {
      initialProps: {
        runId: "run-1",
        handle: "native-1",
        presented: true,
        visible: true,
        modalOpen: false,
      },
    });
    await act(async () => {});

    act(() => host.reportBodyDisengage("native-1", "run-1"));

    const nativeResult = useClientStore.getState();
    expect(nativeResult.editViewBodyEngaged).toBe(false);
    expect(nativeResult.navigationModality).toBe("keyboard");
    expect(nativeResult.editViewZone).toBe("terminal-panel");
    expect(nativeResult.selectedModuleId).toBe("module-1");
    expect(nativeResult.selectedTaskId).toBe("task-1");
    expect(nativeResult.workspaces["task-1"]?.activeDocId).toBe("doc-1");
    expect(nativeResult.activeByTask["task-1"]).toBe("session-1");
    expect(isTerminalPanelOpenIn("module-1")).toBe(true);
    expect(document.activeElement).toBe(zone);
    expect(setBodyEngaged).toHaveBeenCalledTimes(1);
    expect(focusZone).toHaveBeenCalledTimes(1);

    act(() => host.reportBodyDisengage("native-1", "run-1"));
    expect(setBodyEngaged).toHaveBeenCalledTimes(1);
    expect(focusZone).toHaveBeenCalledTimes(1);

    useClientStore.setState({
      editViewBodyEngaged: true,
      navigationModality: "pointer",
    });
    fireEvent.keyDown(window, { key: "Escape", metaKey: true });

    const webViewResult = useClientStore.getState();
    expect(webViewResult.editViewBodyEngaged).toBe(false);
    expect(webViewResult.navigationModality).toBe("keyboard");
    expect(webViewResult.editViewZone).toBe(nativeResult.editViewZone);
    expect(webViewResult.selectedModuleId).toBe(nativeResult.selectedModuleId);
    expect(webViewResult.workspaces).toEqual(nativeResult.workspaces);
    expect(isTerminalPanelOpenIn("module-1")).toBe(true);
    expect(setBodyEngaged).toHaveBeenCalledTimes(2);
    expect(focusZone).toHaveBeenCalledTimes(2);

    harness.unmount();
  });

  it("ignores stale reports and unregisters a disposed viewer", async () => {
    const harness = renderHook(useBodyDisengageHarness, {
      initialProps: {
        runId: "run-1",
        handle: "native-1",
        presented: true,
        visible: true,
        modalOpen: false,
      },
    });
    await act(async () => {});

    harness.rerender({
      runId: "run-2",
      handle: "native-2",
      presented: true,
      visible: true,
      modalOpen: false,
    });
    act(() => host.reportBodyDisengage("native-1", "run-1"));
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);

    act(() => host.reportBodyDisengage("native-2", "run-2"));
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);

    useClientStore.setState({ editViewBodyEngaged: true });
    harness.unmount();
    act(() => host.reportBodyDisengage("native-2", "run-2"));
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
  });

  it("keeps modal focus ownership until the viewer is unoccluded", async () => {
    const modalControl = render(<button>Modal control</button>).getByRole(
      "button",
      { name: "Modal control" },
    );
    modalControl.focus();
    const harness = renderHook(useBodyDisengageHarness, {
      initialProps: {
        runId: "run-1",
        handle: "native-1",
        presented: true,
        visible: true,
        modalOpen: false,
      },
    });
    await act(async () => {});

    useModalStore.setState({ modalStack: [{ type: "settings" }] });
    act(() => host.reportBodyDisengage("native-1", "run-1"));
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
    expect(document.activeElement).toBe(modalControl);

    useModalStore.setState({ modalStack: [] });
    act(() => host.reportBodyDisengage("native-1", "run-1"));
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);

    harness.unmount();
  });
});
