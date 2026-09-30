import { readVersionedItem } from "../shared/storage/versioned";

export const SIDEBAR_KEY = "studio.sidebarVisible:v2";
export const PANEL_LAYOUT_KEY = "studio.panelLayout:v1";
export const EXPANDED_IDS_KEY = "studio.expandedSubtasks:v1";
export const COLLAPSED_STATE_IDS_KEY = "studio.collapsedStates:v2";
export const TASK_SELECTIONS_KEY = "studio.selectedTaskByModule:v1";
export const RECENT_MODULE_KEY = "studio.recentModule:v1";
export const TERMINAL_PANEL_KEY = "studio.terminalPanel:v1";

const LEGACY_SIDEBAR_KEYS = ["plane-tui:sidebar-visible"];
const LEGACY_PANEL_LAYOUT_KEYS = ["plane-tui:panel-layout"];
const LEGACY_COLLAPSED_STATE_KEYS = [
  "studio.collapsedStates:v1",
  "plane-tui:collapsed-states",
] as const;
const LEGACY_TASK_SELECTIONS_KEYS = [
  "studio.studio.selectedTaskByModule",
  "studio.coding.selectedTaskByModule",
] as const;

const MAX_TASK_SELECTION_ENTRIES = 100;

export const PANEL_LAYOUT_SAVE_DELAY_MS = 400;
export const TERMINAL_PANEL_SAVE_DELAY_MS = PANEL_LAYOUT_SAVE_DELAY_MS;

let panelLayoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
let terminalPanelSaveTimer: ReturnType<typeof setTimeout> | null = null;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function readSidebarVisible(): boolean {
  return readVersionedItem(SIDEBAR_KEY, LEGACY_SIDEBAR_KEYS) !== "false";
}

export function writeSidebarVisible(visible: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(visible));
  } catch {
    /* unavailable storage leaves the in-memory preference intact */
  }
}

/**
 * The one module this installation was last working in.
 *
 * This is the single client-local navigation value that survives a reload. It
 * is not a map keyed by project — there is one installation project — and it is
 * deliberately not server state: which module a person had open is a property
 * of this webview, not of the Module.
 */
export function readRecentModule(): string | null {
  try {
    return localStorage.getItem(RECENT_MODULE_KEY);
  } catch {
    return null;
  }
}

export function writeRecentModule(moduleId: string): void {
  try {
    localStorage.setItem(RECENT_MODULE_KEY, moduleId);
  } catch {
    /* unavailable storage leaves the in-memory selection intact */
  }
}

export function clearRecentModule(): void {
  try {
    localStorage.removeItem(RECENT_MODULE_KEY);
  } catch {
    /* unavailable storage leaves the in-memory selection intact */
  }
}

/** Panel sizes, migrating the retired leading projects-pane slot away. */
export function readPanelLayout(): number[] | null {
  try {
    const raw = readVersionedItem(PANEL_LAYOUT_KEY, LEGACY_PANEL_LAYOUT_KEYS);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPanelLayout(parsed)) return null;
    return parsed.length === 4 ? parsed.slice(1) : parsed;
  } catch {
    return null;
  }
}

export function isPanelLayout(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((size) => typeof size === "number" && Number.isFinite(size))
  );
}

export function persistPanelLayout(sizes: number[]): void {
  if (panelLayoutSaveTimer !== null) clearTimeout(panelLayoutSaveTimer);
  panelLayoutSaveTimer = setTimeout(() => {
    panelLayoutSaveTimer = null;
    try {
      localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(sizes));
    } catch {
      /* unavailable storage leaves the in-memory preference intact */
    }
  }, PANEL_LAYOUT_SAVE_DELAY_MS);
}

/**
 * The terminal panel's *furniture*: how tall it is (#669). Height belongs to
 * the window, so it lives under a global key beside sidebar visibility and the
 * pane layout.
 *
 * Whether the panel is showing is deliberately not here — it belongs to the
 * module the panel opens onto (#730) — and neither are the shells a module owns
 * or which of them is active. All three are module-scoped content, keyed per
 * module elsewhere, so moving across module tabs never twitches the window's
 * own geometry.
 */
export interface TerminalPanelFurniture {
  /** The person's ordinary height, never a viewport-derived maximized one. */
  height: number;
  /** Whether the panel renders at the geometry policy's current bound (#726). */
  maximized: boolean;
}

export function readTerminalPanelFurniture(): Partial<TerminalPanelFurniture> {
  try {
    const raw = readVersionedItem(TERMINAL_PANEL_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    // A record written before the open flag moved to the module still holds
    // one, and one written while the restore height was a separate field still
    // holds that; the height beside them is read and the stale fields are
    // simply dropped. The restore height only ever equalled the height, so
    // ignoring it loses nothing.
    const height = finiteNumber(record.height);
    if (height === null) return {};
    // A legacy record has a height and no size mode: it is ordinary at that
    // height, which is exactly what leaving the mode out produces.
    return {
      height,
      ...(record.maximized === true ? { maximized: true } : {}),
    };
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Debounced like the pane layout: a drag writes once it settles, not per frame. */
export function persistTerminalPanelFurniture(
  furniture: TerminalPanelFurniture,
): void {
  if (terminalPanelSaveTimer !== null) clearTimeout(terminalPanelSaveTimer);
  terminalPanelSaveTimer = setTimeout(() => {
    terminalPanelSaveTimer = null;
    try {
      localStorage.setItem(TERMINAL_PANEL_KEY, JSON.stringify(furniture));
    } catch {
      /* unavailable storage leaves the in-memory preference intact */
    }
  }, TERMINAL_PANEL_SAVE_DELAY_MS);
}

export function readExpandedIdsByModule(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(EXPANDED_IDS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every(isStringArray)
    ) {
      return parsed as Record<string, string[]>;
    }
  } catch {
    /* unavailable or corrupt storage degrades to no remembered expansion */
  }
  return {};
}

export function writeExpandedIdsByModule(
  expandedIdsByModule: Readonly<Record<string, readonly string[]>>,
): void {
  try {
    localStorage.setItem(EXPANDED_IDS_KEY, JSON.stringify(expandedIdsByModule));
  } catch {
    /* unavailable storage leaves the in-memory preference intact */
  }
}

export function readTaskSelections(): Record<string, string> {
  try {
    const raw = readVersionedItem(
      TASK_SELECTIONS_KEY,
      LEGACY_TASK_SELECTIONS_KEYS,
    );
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export function rememberTaskSelection(moduleId: string, taskId: string): void {
  try {
    const current = readTaskSelections();
    // Object insertion order records recency: touch this module at the end,
    // then discard the oldest entries so local storage cannot grow forever.
    delete current[moduleId];
    const entries = [...Object.entries(current), [moduleId, taskId] as const];
    localStorage.setItem(
      TASK_SELECTIONS_KEY,
      JSON.stringify(
        Object.fromEntries(entries.slice(-MAX_TASK_SELECTION_ENTRIES)),
      ),
    );
  } catch {
    /* unavailable storage leaves the in-memory selection intact */
  }
}

export interface CollapsedStateStorage {
  ids: Set<string>;
  legacyNames: string[] | null;
}

function parseStringSet(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read v2 ids without copying a legacy name payload under the new key. Legacy
 * names stay pending until the workflow-state catalogue is available.
 */
export function readCollapsedStateStorage(): CollapsedStateStorage {
  try {
    const ids = parseStringSet(localStorage.getItem(COLLAPSED_STATE_IDS_KEY));
    if (ids !== null) return { ids: new Set(ids), legacyNames: null };

    for (const key of LEGACY_COLLAPSED_STATE_KEYS) {
      const names = parseStringSet(localStorage.getItem(key));
      if (names !== null) return { ids: new Set(), legacyNames: names };
    }
  } catch {
    /* unavailable storage degrades to no collapsed state */
  }
  return { ids: new Set(), legacyNames: null };
}

export function writeCollapsedStateIds(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STATE_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    /* unavailable storage leaves the in-memory preference intact */
  }
}

export function finishCollapsedStateMigration(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STATE_IDS_KEY, JSON.stringify([...ids]));
    for (const key of LEGACY_COLLAPSED_STATE_KEYS) localStorage.removeItem(key);
  } catch {
    /* migration can retry on a later launch when storage becomes available */
  }
}
