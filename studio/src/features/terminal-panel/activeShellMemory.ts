/**
 * Which shell each module last had in front, across restarts (#687).
 *
 * The shell *set* is rediscovered from the backend rather than remembered here:
 * the shells that survive a restart or a sidecar rebuild are the ones the
 * server still holds a session for. But which of them was showing has no
 * backend source at all — it is a per-person, per-module choice — so without
 * this record a restart always lands on whichever shell happens to be first.
 *
 * Module-scoped content lives under its own versioned key, apart from the
 * window furniture (open flag and height) in `state/persistence`, so a module
 * switch never rewrites the window's geometry and vice versa.
 */

import { readVersionedItem } from "../../shared/storage/versioned";
import { TERMINAL_PANEL_SAVE_DELAY_MS } from "../../state/persistence";

// Versioned key (client-localstorage-schema); reads require a
// module id -> run id map and there is no legacy spelling to migrate.
export const ACTIVE_SHELL_KEY = "studio.terminalPanelActiveShell:v1";

/**
 * One entry per module ever opened would otherwise grow forever. Insertion
 * order records recency, so the oldest modules are the ones dropped.
 */
const MAX_ACTIVE_SHELL_ENTRIES = 100;

/**
 * Changes not yet written out. Held so a read during the debounce window still
 * answers with the tab the person is actually looking at, and so a burst of tab
 * switches costs one write rather than one per click.
 */
let pending: Record<string, string | null> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function readStored(): Record<string, string> {
  try {
    const raw = readVersionedItem(ACTIVE_SHELL_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    /* unavailable or corrupt storage degrades to nothing remembered */
    return {};
  }
}

/** The shell this module last had in front, or null when none is remembered. */
export function readActiveShell(moduleId: string): string | null {
  if (moduleId in pending) return pending[moduleId];
  return readStored()[moduleId] ?? null;
}

function flush(): void {
  saveTimer = null;
  const writes = pending;
  pending = {};
  try {
    const current = readStored();
    for (const [moduleId, runId] of Object.entries(writes)) {
      // Touch this module at the end either way, so recency reflects use.
      delete current[moduleId];
      if (runId !== null) current[moduleId] = runId;
    }
    localStorage.setItem(
      ACTIVE_SHELL_KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(current).slice(-MAX_ACTIVE_SHELL_ENTRIES),
        ),
      ),
    );
  } catch {
    /* unavailable storage leaves the in-memory active tab intact */
  }
}

/**
 * Records this module's active tab, or forgets it when the strip has none.
 *
 * Debounced like the panel furniture: clicking along the strip writes once it
 * settles rather than on every tab.
 */
export function rememberActiveShell(
  moduleId: string,
  runId: string | null,
): void {
  if (!moduleId) return;
  pending[moduleId] = runId;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, TERMINAL_PANEL_SAVE_DELAY_MS);
}
