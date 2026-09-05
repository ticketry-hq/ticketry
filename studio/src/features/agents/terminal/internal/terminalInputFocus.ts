/**
 * One place that answers "is this element a terminal's keyboard target?".
 *
 * xterm parks focus on a helper textarea inside `.xterm` rather than on the
 * drawing surface. Shell navigation needs to recognise it — otherwise a
 * focus-restoring effect blurs a terminal the user just clicked into — so the
 * selector lives here instead of being sprinkled through the workspace shell.
 */

const XTERM_SELECTOR = ".xterm";

/** True when `element` is (or sits inside) a terminal's keyboard target. */
export function isTerminalInputElement(element: unknown): boolean {
  if (!(element instanceof Element)) return false;
  return element.closest(XTERM_SELECTOR) !== null;
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
