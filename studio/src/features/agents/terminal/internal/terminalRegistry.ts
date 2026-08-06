/**
 * Live terminal capabilities. Renderer objects and focus callbacks are runtime
 * resources, not application state, so they live in this module registry.
 */
type FocusTerminal = () => void;

const focusers = new Map<string, FocusTerminal>();

export function registerTerminalFocus(
  sessionId: string,
  focus: FocusTerminal,
): () => void {
  focusers.set(sessionId, focus);
  return () => {
    if (focusers.get(sessionId) === focus) focusers.delete(sessionId);
  };
}

export function focusTerminal(sessionId: string): void {
  focusers.get(sessionId)?.();
}

export function rekeyTerminalFocus(from: string, to: string): void {
  if (from === to) return;
  const focus = focusers.get(from);
  if (!focus) return;
  focusers.delete(from);
  focusers.set(to, focus);
}
