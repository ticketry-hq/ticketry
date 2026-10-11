import { normalizePanelLayout } from "../../../state/persistence";

// Preserve the established Stories/workspace ratio after removing the sidebar.
export const DEFAULT_PANEL_LAYOUT = [44 / 82 * 100, 38 / 82 * 100];

export function splitWorkArea(layout: number[]): [number, number] {
  return normalizePanelLayout(layout) ?? [...DEFAULT_PANEL_LAYOUT] as [number, number];
}
