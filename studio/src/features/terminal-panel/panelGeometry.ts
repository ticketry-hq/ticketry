/**
 * How tall the terminal panel may be (#669).
 *
 * The default matches the height Studio's sibling terminal surfaces settle on:
 * enough rows to read a test run without burying the work item above it. The
 * bounds keep a drag from producing a panel too short to hold a prompt line or
 * tall enough to swallow the workspace it belongs to — the upper bound also
 * follows the viewport, because a fixed pixel ceiling is meaningless on a
 * laptop screen.
 */

export const TERMINAL_PANEL_DEFAULT_HEIGHT_PX = 280;
export const TERMINAL_PANEL_MIN_HEIGHT_PX = 120;
export const TERMINAL_PANEL_MAX_HEIGHT_PX = 800;
/** The panel never takes more than this share of the window. */
const MAX_VIEWPORT_SHARE = 0.8;

/** Keyboard resize step, so the grip is usable without a pointer. */
export const TERMINAL_PANEL_HEIGHT_STEP_PX = 24;

/**
 * The tallest the panel may currently be. Maximizing renders here rather than
 * at a stored pixel value, so the maximized panel follows the window instead of
 * stranding itself above the bound when the window shrinks (#726).
 *
 * A window too short for the panel's viewport share, or one that cannot be
 * measured at all, falls back to the smallest usable panel rather than the
 * absolute cap (#737): the bound is what a single click writes into the
 * panel's height, so guessing large there would push the module tabs, the
 * footer and the work-item workspace out of a window that has no room for
 * them.
 */
export function maxPanelHeight(): number {
  const viewport =
    typeof window === "undefined" ? 0 : window.innerHeight * MAX_VIEWPORT_SHARE;
  if (!Number.isFinite(viewport) || viewport <= TERMINAL_PANEL_MIN_HEIGHT_PX) {
    return TERMINAL_PANEL_MIN_HEIGHT_PX;
  }
  return Math.min(TERMINAL_PANEL_MAX_HEIGHT_PX, viewport);
}

/**
 * The height the panel actually renders at: the current upper bound while it
 * is maximized, and the person's clamped ordinary height otherwise (#726).
 */
export function panelDisplayHeight(size: {
  height: number;
  maximized: boolean;
}): number {
  return size.maximized
    ? Math.round(maxPanelHeight())
    : clampPanelHeight(size.height);
}

/** Clamps any candidate height, including a corrupt persisted one. */
export function clampPanelHeight(height: number): number {
  if (!Number.isFinite(height)) return TERMINAL_PANEL_DEFAULT_HEIGHT_PX;
  return Math.round(
    Math.min(Math.max(height, TERMINAL_PANEL_MIN_HEIGHT_PX), maxPanelHeight()),
  );
}
