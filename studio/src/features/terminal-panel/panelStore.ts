/**
 * The terminal panel's state: which modules are showing it, and how tall it is
 * (#667, #669, #730).
 *
 * The toggle is strictly two-state: closed opens the panel and focuses its
 * shell; open closes it wherever focus currently sits. VS Code's three-state
 * behaviour (open-but-unfocused focuses rather than closes) was considered and
 * rejected, so there is no "focused" flag to track here.
 *
 * Whether the panel is showing is held **per module**, because the panel opens
 * onto one module's repository: wanting a shell in front of the work is a fact
 * about that module, not about the window (#730). The height stays global — it
 * is the window's own geometry, and a module switch must not resize the layout.
 * Which shells a module owns stays with the module too, in `moduleShellStore`;
 * nothing about shell membership belongs here.
 */

import { create } from "zustand";

import { useClientStore } from "../../state/clientStore";
import {
  persistTerminalPanelFurniture,
  readTerminalPanelFurniture,
} from "../../state/persistence";
import {
  clampPanelHeight,
  panelDisplayHeight,
  TERMINAL_PANEL_DEFAULT_HEIGHT_PX,
  TERMINAL_PANEL_HEIGHT_STEP_PX,
} from "./panelGeometry";
import { readOpenModules, rememberPanelOpen } from "./panelOpenMemory";

interface TerminalPanelState {
  /** Whether each module's panel is showing; absent means closed. */
  openModules: Record<string, boolean>;
  /**
   * The person's ordinary panel height in pixels, always within
   * {@link clampPanelHeight}'s bounds. A maximized panel renders taller than
   * this without overwriting it (#726).
   */
  height: number;
  /**
   * Whether the panel renders at the geometry policy's current upper bound.
   * Maximized is a size mode inside the open panel, not a third open state:
   * hiding and reopening keeps it (#726).
   */
  maximized: boolean;
  /**
   * Bumped every time the panel is opened or entered. `<Terminal>` treats a
   * changed focus signal as "put the keyboard in this terminal", which is how
   * one keystroke both reveals the shell and lands the caret in it.
   */
  focusSignal: number;
  openPanel: (moduleId: string) => void;
  closePanel: (moduleId: string) => void;
  togglePanel: (moduleId: string) => void;
  /** Puts the keyboard back in the shell without changing open state. */
  focusShell: () => void;
  /**
   * Sets the ordinary height. Direct manipulation is authoritative, so this
   * also leaves maximized mode: fine resizing never fights a hidden flag.
   */
  setHeight: (height: number) => void;
  /** Grows (positive) or shrinks (negative) the panel by one keyboard step. */
  nudgeHeight: (steps: number) => void;
  /** Renders at the current upper bound, leaving `height` as it stands. */
  maximizePanel: () => void;
  /** Returns to the ordinary height, clamped for this viewport. */
  restorePanelSize: () => void;
  /** The one control the panel header shows, in whichever mode it is in. */
  toggleMaximized: () => void;
}

const restored = readTerminalPanelFurniture();

export const useTerminalPanelStore = create<TerminalPanelState>((set, get) => {
  function setOpen(moduleId: string, open: boolean): void {
    if (!moduleId) return;
    set((state) => ({
      openModules: { ...state.openModules, [moduleId]: open },
      focusSignal: open ? state.focusSignal + 1 : state.focusSignal,
    }));
    rememberPanelOpen(moduleId, open);
  }

  /**
   * Writes one size decision to the store and to the single debounced
   * furniture record, so the mode and the ordinary height can never be
   * persisted out of step with each other.
   */
  function commitSize(size: { height: number; maximized: boolean }): void {
    set(size);
    persistTerminalPanelFurniture(size);
  }

  const restoredHeight = clampPanelHeight(
    restored.height ?? TERMINAL_PANEL_DEFAULT_HEIGHT_PX,
  );

  return {
    openModules: readOpenModules(),
    height: restoredHeight,
    // A legacy or corrupt record carries no mode, which restores as an
    // ordinary panel at the height the clamping policy already produced.
    maximized: restored.maximized ?? false,
    focusSignal: 0,

    openPanel(moduleId) {
      setOpen(moduleId, true);
    },

    closePanel(moduleId) {
      setOpen(moduleId, false);
    },

    togglePanel(moduleId) {
      setOpen(moduleId, !isOpenIn(get().openModules, moduleId));
    },

    focusShell() {
      set((state) => ({ focusSignal: state.focusSignal + 1 }));
    },

    setHeight(height) {
      const clamped = clampPanelHeight(height);
      // Sizing the panel directly is the person saying what ordinary means, so
      // it leaves maximized mode and becomes the height restore returns to.
      commitSize({ height: clamped, maximized: false });
    },

    nudgeHeight(steps) {
      // Nudging a maximized panel starts from the height it is showing, not
      // from the ordinary height hidden behind it.
      get().setHeight(
        panelDisplayHeight(get()) + steps * TERMINAL_PANEL_HEIGHT_STEP_PX,
      );
    },

    maximizePanel() {
      // The rendered maximized height is never stored: it is recomputed from
      // the geometry policy, so a smaller window cannot strand the panel.
      // `height` keeps holding the ordinary preference, which is exactly what
      // restoring returns to — there is no second copy to keep in step.
      commitSize({ height: clampPanelHeight(get().height), maximized: true });
    },

    restorePanelSize() {
      commitSize({ height: clampPanelHeight(get().height), maximized: false });
    },

    toggleMaximized() {
      if (get().maximized) get().restorePanelSize();
      else get().maximizePanel();
    },
  };
});

function isOpenIn(
  openModules: Record<string, boolean>,
  moduleId: string | null,
): boolean {
  return moduleId ? openModules[moduleId] ?? false : false;
}

/**
 * Whether one module's panel is showing. Callers that already hold a module id
 * — a module switch deciding what the incoming module looks like — ask this.
 */
export function isTerminalPanelOpenIn(moduleId: string | null): boolean {
  return isOpenIn(useTerminalPanelStore.getState().openModules, moduleId);
}

/**
 * Whether the panel is on screen, for callers outside React. The navigation
 * zone cycle asks this: a closed panel is not a zone anyone can reach.
 */
export function isTerminalPanelOpen(): boolean {
  return isTerminalPanelOpenIn(useClientStore.getState().selectedModuleId);
}

/** Whether the selected module's panel is showing, for React callers. */
export function useTerminalPanelOpen(): boolean {
  const moduleId = useClientStore((state) => state.selectedModuleId);
  return useTerminalPanelStore((state) => isOpenIn(state.openModules, moduleId));
}
