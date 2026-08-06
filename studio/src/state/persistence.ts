import { readVersionedItem } from "../shared/storage/versioned";

export const SIDEBAR_KEY = "studio.sidebarVisible:v1";
export const PANEL_LAYOUT_KEY = "studio.panelLayout:v1";
export const EXPANDED_IDS_KEY = "studio.expandedSubtasks:v1";
export const COLLAPSED_STATE_IDS_KEY = "studio.collapsedStates:v2";

const LEGACY_SIDEBAR_KEYS = ["plane-tui:sidebar-visible"];
const LEGACY_PANEL_LAYOUT_KEYS = ["plane-tui:panel-layout"];
const LEGACY_COLLAPSED_STATE_KEYS = [
  "studio.collapsedStates:v1",
  "plane-tui:collapsed-states",
] as const;

export const PANEL_LAYOUT_SAVE_DELAY_MS = 400;

let panelLayoutSaveTimer: ReturnType<typeof setTimeout> | null = null;

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

export function readPanelLayout(): number[] | null {
  try {
    const raw = readVersionedItem(PANEL_LAYOUT_KEY, LEGACY_PANEL_LAYOUT_KEYS);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPanelLayout(parsed) ? parsed : null;
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
