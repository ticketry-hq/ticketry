/**
 * Studio's desktop route out of an engaged native terminal (#684, #735).
 *
 * On the desktop build's native renderer the libghostty NSView is first
 * responder while an agent terminal is engaged, and AppKit delivers every key
 * to it — the WebView sees nothing, so a keymap binding cannot fire from a
 * `keydown` that never arrives. The native view therefore recognises the few
 * chords that must survive that state itself, hands the keyboard back to the
 * WebView, and reports them here. Only the chord is native: each one is routed
 * to the same action its WebView binding already owns.
 */

import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { useModalStore } from "../modal/modalStore";
import { toggleTerminalPanel } from "../../features/terminal-panel";
import {
  isModulePosition,
  modulePositionActionId,
  closeActiveWorkspaceTerminal,
  routeModulePositionNavigation,
  type ModulePosition,
} from "./sharedNavigation";
import { disengageEditViewBody } from "./three-zone/threeZoneNavigation";
import { isNativeTerminalKeyboardOwner } from "../../runtime/nativeTerminalKeyboard";
import { openModuleManager, useModuleManagerStore } from "../../features/module-manager/state";
import { studioKeymapRegistry } from "./keymapRegistry";
import { useTerminalStore } from "../../features/agents/terminal/appNavigation";

/** Emitted by the native host for one recognised chord. */
export const NATIVE_TERMINAL_CHORD_EVENT = "native-terminal-chord";

/** The chords the native viewer keeps from the terminal. */
export type NativeTerminalChord =
  | "panel-toggle"
  | "settings"
  | "close-tab"
  | "module-manager"
  | "body-disengage"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | `module-position-${ModulePosition}`;

interface NativeTerminalChordEvent {
  payload?: { handle?: string; runId?: string; chord?: string };
}

const CHORD_ACTIONS: Record<"panel-toggle" | "settings", () => void> = {
  "panel-toggle": toggleTerminalPanel,
  // Settings stays the singleton overlay the footer and the global binding
  // both open; the chord only reaches the same store action (#718).
  settings: () => useModalStore.getState().openSettings(),
};

function modulePositionFromChord(
  chord: string | undefined,
): ModulePosition | null {
  const match = chord?.match(/^module-position-(10|[1-9])$/)?.[1];
  if (!match) return null;
  const position = Number(match);
  return isModulePosition(position) ? position : null;
}

function runChord(payload: NativeTerminalChordEvent["payload"]): void {
  if (useModuleManagerStore.getState().active) return;
  const chord = payload?.chord;
  if (chord === "module-manager") {
    if (useModalStore.getState().modalStack.length === 0 && payload?.handle && payload.runId &&
      isNativeTerminalKeyboardOwner({ handle: payload.handle, runId: payload.runId })) {
      const sessionId = Object.values(useTerminalStore.getState().sessions)
        .find((session) => session.agentRunId === payload.runId)?.sessionId;
      openModuleManager({ restoreFocus: sessionId ? () => {
        if (useTerminalStore.getState().sessions[sessionId]?.agentRunId === payload.runId)
          useTerminalStore.getState().focusSession(sessionId);
        else document.querySelector<HTMLElement>("[data-module-manager-toggle]")?.focus();
      } : undefined });
    }
    return;
  }
  if (chord === "close-tab") {
    if (
      useModalStore.getState().modalStack.length === 0 &&
      payload?.handle && payload.runId &&
      isNativeTerminalKeyboardOwner({
        handle: payload.handle,
        runId: payload.runId,
      })
    ) {
      closeActiveWorkspaceTerminal(payload.runId);
    }
    return;
  }
  if (chord === "zoom-in" || chord === "zoom-out" || chord === "zoom-reset") {
    if (
      payload?.handle && payload.runId &&
      isNativeTerminalKeyboardOwner({
        handle: payload.handle,
        runId: payload.runId,
      })
    ) {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: chord === "zoom-in" ? "+" : chord === "zoom-out" ? "-" : "0",
        metaKey: true,
      }));
    }
    return;
  }
  if (chord === "body-disengage") {
    if (
      useModalStore.getState().modalStack.length === 0 &&
      payload?.handle &&
      payload.runId &&
      isNativeTerminalKeyboardOwner({
        handle: payload.handle,
        runId: payload.runId,
      })
    ) {
      disengageEditViewBody();
    }
    return;
  }
  const modulePosition = modulePositionFromChord(chord);
  if (modulePosition !== null) {
    routeModulePositionNavigation(
      null,
      modulePositionActionId(modulePosition),
    );
    return;
  }
  const action = CHORD_ACTIONS[chord as keyof typeof CHORD_ACTIONS];
  // A host newer than this WebView can report a chord this build has no
  // action for; ignoring it is better than acting as the wrong one.
  action?.();
}

/** Subscribes to native chords; returns the matching unsubscribe. */
export function subscribeNativeTerminalChords(): () => void {
  if (!isTauri()) return () => {};
  let active = true;
  let unlisten: UnlistenFn | null = null;
  const syncManagerShortcut = () => {
    const chord = studioKeymapRegistry.getEffectiveBinding("global", "toggle-module-manager")?.chord;
    if (!chord) return;
    const modifiers = (chord.shift ? 1 << 17 : 0) | (chord.control ? 1 << 18 : 0)
      | (chord.alt ? 1 << 19 : 0) | (chord.meta ? 1 << 20 : 0);
    void Promise.resolve(invoke("native_terminal_set_module_manager_shortcut", { key: chord.key, modifiers }))
      .catch((error) => console.warn("[keymap] native Module Manager shortcut unavailable", error));
  };
  syncManagerShortcut();
  const unsubscribeKeymap = studioKeymapRegistry.subscribe(syncManagerShortcut);
  void listen(NATIVE_TERMINAL_CHORD_EVENT, (event: NativeTerminalChordEvent) => {
    if (active) runChord(event.payload);
  })
    .then((stop) => {
      unlisten = stop;
      if (!active) stop();
    })
    .catch(() => {});
  return () => {
    active = false;
    unsubscribeKeymap();
    unlisten?.();
  };
}
