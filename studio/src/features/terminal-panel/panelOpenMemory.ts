/**
 * Whether each module's terminal panel is showing, across restarts (#730).
 *
 * The panel opens onto one module's repository, so wanting a shell in front of
 * the work is a fact about that module rather than about the window: the module
 * an agent is driving wants the panel shut, the one a dev server runs in wants
 * it open. A single window-wide flag could only ever be wrong for one of them.
 *
 * Module-scoped content lives under its own versioned key beside the active-tab
 * record in {@link ./activeShellMemory}, apart from the window furniture — the
 * panel's height — in `state/persistence`. A module switch never rewrites the
 * window's geometry and a drag never rewrites any module's open state.
 */

import { readVersionedItem } from "../../shared/storage/versioned";
import { TERMINAL_PANEL_SAVE_DELAY_MS } from "../../state/persistence";

// Versioned key (client-localstorage-schema). The window-wide flag this
// replaces mapped onto no module, so there is no legacy spelling to migrate:
// a module nobody has opened the panel in simply starts closed.
export const PANEL_OPEN_KEY = "studio.terminalPanelOpen:v1";

/**
 * One entry per module ever opened would otherwise grow forever. Insertion
 * order records recency, so the oldest modules are the ones dropped.
 */
const MAX_PANEL_OPEN_ENTRIES = 100;

/**
 * Changes not yet written out. Held so a read during the debounce window still
 * answers with what the person is actually looking at, and so a burst of
 * toggles costs one write rather than one per keystroke.
 */
let pending: Record<string, boolean> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function readStored(): Record<string, boolean> {
  try {
    const raw = readVersionedItem(PANEL_OPEN_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    /* unavailable or corrupt storage degrades to every panel starting closed */
    return {};
  }
}

/** Every module whose panel state is remembered, for a store's initial value. */
export function readOpenModules(): Record<string, boolean> {
  return { ...readStored(), ...pending };
}

function flush(): void {
  saveTimer = null;
  const writes = pending;
  pending = {};
  try {
    const current = readStored();
    for (const [moduleId, open] of Object.entries(writes)) {
      // Touch this module at the end, so recency reflects use.
      delete current[moduleId];
      current[moduleId] = open;
    }
    localStorage.setItem(
      PANEL_OPEN_KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(current).slice(-MAX_PANEL_OPEN_ENTRIES),
        ),
      ),
    );
  } catch {
    /* unavailable storage leaves the in-memory open state intact */
  }
}

/**
 * Records whether this module's panel is showing.
 *
 * Debounced like the panel's height: a burst of toggles writes once it settles.
 */
export function rememberPanelOpen(moduleId: string, open: boolean): void {
  if (!moduleId) return;
  pending[moduleId] = open;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, TERMINAL_PANEL_SAVE_DELAY_MS);
}
