/**
 * The panel toggle from inside a native terminal (#684).
 *
 * On the desktop build's default renderer the libghostty NSView is first
 * responder while an agent terminal is engaged, so AppKit delivers the toggle
 * chord to it and the WebView never sees a keydown at all. The panel gate's
 * other cases dispatch keydown on `window`, which only ever exercises the
 * browser route; what is asserted here is the desktop route: a chord reported
 * by the native host reaches the same toggle, with the same effect on the
 * navigation zone, and stops once the surface is unmounted.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { NATIVE_TERMINAL_CHORD_EVENT } from "../app/navigation/nativeTerminalChords";
import {
  isTerminalPanelOpenIn,
  useTerminalPanelStore,
} from "../features/terminal-panel";
import { useClientStore } from "../state/clientStore";

const runtime = vi.hoisted(() => ({ desktop: true }));

const host = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    listeners,
    listen: vi.fn(async (event: string, handler: (event: unknown) => void) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    }),
    /** Stands in for the native view reporting one recognised chord. */
    reportChord: (chord: string) =>
      listeners.get(NATIVE_TERMINAL_CHORD_EVENT)?.({
        payload: { handle: "native-1", runId: "run-1", chord },
      }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => runtime.desktop,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: host.listen }));

describe("terminal panel — native chord", () => {
  beforeEach(() => {
    runtime.desktop = true;
    host.listeners.clear();
    host.listen.mockClear();
    useTerminalPanelStore.setState({ openModules: {} });
    // The panel belongs to the module it opens onto, so the chord needs one
    // selected to act on (#730).
    useClientStore.setState({ selectedModuleId: "module-1" });
    useClientStore.getState().setEditViewZone("active-tab-body");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("[overhaul-91-native] reveals and reverses the panel from an engaged native terminal", async () => {
    const keymap = renderHook(() => useGlobalKeymap());
    await act(async () => {});

    // Opening: the panel shows and becomes the navigation zone, exactly as the
    // WebView binding leaves things.
    act(() => {
      host.reportChord("panel-toggle");
    });
    expect(isTerminalPanelOpenIn("module-1")).toBe(true);
    expect(useClientStore.getState().editViewZone).toBe("terminal-panel");

    // Reversing from the panel's own terminal hands the zone back.
    act(() => {
      host.reportChord("panel-toggle");
    });
    expect(isTerminalPanelOpenIn("module-1")).toBe(false);
    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");

    keymap.unmount();
    expect(host.listeners.has(NATIVE_TERMINAL_CHORD_EVENT)).toBe(false);
  });

  it("[overhaul-91-native] leaves another surface's chord alone", async () => {
    const keymap = renderHook(() => useGlobalKeymap());
    await act(async () => {});

    // One bridge carries every chord, so the panel must react to its own and
    // to no other.
    act(() => {
      host.reportChord("settings");
    });
    expect(isTerminalPanelOpenIn("module-1")).toBe(false);

    keymap.unmount();
  });

  it("[overhaul-91-native] leaves the browser build with no host subscription", async () => {
    runtime.desktop = false;
    renderHook(() => useGlobalKeymap());
    await act(async () => {});

    expect(host.listen).not.toHaveBeenCalled();
  });
});
