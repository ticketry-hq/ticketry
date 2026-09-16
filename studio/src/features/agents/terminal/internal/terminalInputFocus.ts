/**
 * One place that answers "is this element a terminal's keyboard target?".
 *
 * xterm parks focus on a helper textarea inside `.xterm` rather than on the
 * drawing surface. Shell navigation needs to recognise it — otherwise a
 * focus-restoring effect blurs a terminal the user just clicked into — so the
 * selector lives here instead of being sprinkled through the workspace shell.
 */

const XTERM_SELECTOR = ".xterm";

/**
 * Set on a native libghostty host while its AppKit view owns keyboard input.
 * Native input leaves no focused DOM element behind, so this marker is the
 * only DOM evidence that the terminal, not the WebView, holds the keyboard.
 */
export const NATIVE_TERMINAL_INPUT_ATTRIBUTE = "data-native-terminal-input";
const NATIVE_INPUT_SELECTOR = `[${NATIVE_TERMINAL_INPUT_ATTRIBUTE}]`;
const TERMINAL_INPUT_SELECTOR = `${XTERM_SELECTOR}, ${NATIVE_INPUT_SELECTOR}`;

/** True when `element` is (or sits inside) a terminal's keyboard target. */
export function isTerminalInputElement(element: unknown): boolean {
  if (!(element instanceof Element)) return false;
  return element.closest(TERMINAL_INPUT_SELECTOR) !== null;
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
  if (container.querySelector(NATIVE_INPUT_SELECTOR)) return true;
  const active = container.ownerDocument?.activeElement ?? null;
  if (!active || active === container) return false;
  return container.contains(active) && isTerminalInputElement(active);
}
