/**
 * One place that answers "is this element a terminal's keyboard target?".
 *
 * Both renderers park focus on a hidden element rather than on the drawing
 * surface: xterm builds its helper textarea inside `.xterm`, and the
 * ghostty-wasm surface creates a 1px textarea tagged
 * `data-testid="ghostty-wasm-input"`. Shell navigation needs to recognise
 * both — otherwise a focus-restoring effect blurs a terminal the user just
 * clicked into — so the selectors live here instead of being sprinkled
 * through the workspace shell.
 */

const GHOSTTY_WASM_INPUT_SELECTOR = '[data-testid="ghostty-wasm-input"]';
const XTERM_SELECTOR = ".xterm";

/** True when `element` is (or sits inside) a terminal's keyboard target. */
export function isTerminalInputElement(element: unknown): boolean {
  if (!(element instanceof Element)) return false;
  return (
    element.closest(GHOSTTY_WASM_INPUT_SELECTOR) !== null ||
    element.closest(XTERM_SELECTOR) !== null
  );
}

/**
 * True when the document's focus already rests on a terminal input contained
 * by `container`. Focus-restoring effects treat that as "already focused in
 * this zone" and leave the terminal alone.
 */
export function hasFocusedTerminalInput(
  container: Element | null | undefined,
): boolean {
  if (!container) return false;
  const active = container.ownerDocument?.activeElement ?? null;
  if (!active || active === container) return false;
  return container.contains(active) && isTerminalInputElement(active);
}
