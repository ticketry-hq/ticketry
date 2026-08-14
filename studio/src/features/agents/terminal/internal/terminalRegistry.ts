/**
 * Live terminal capabilities. Renderer objects and focus callbacks are runtime
 * resources, not application state, so they live in this module registry.
 */
type FocusTerminal = () => void;

const focusers = new Map<string, FocusTerminal>();
// Selecting a tab focuses its terminal in the same tick, before that terminal
// has become visible and registered a focuser. The request is held for exactly
// one session — a later selection supersedes it — and delivered on registration.
let pendingFocus: string | null = null;

export function registerTerminalFocus(
  sessionId: string,
  focus: FocusTerminal,
): () => void {
  focusers.set(sessionId, focus);
  if (pendingFocus === sessionId) {
    pendingFocus = null;
    focus();
  }
  return () => {
    if (focusers.get(sessionId) === focus) focusers.delete(sessionId);
  };
}

export function focusTerminal(sessionId: string): void {
  const focus = focusers.get(sessionId);
  pendingFocus = focus ? null : sessionId;
  focus?.();
}

export function rekeyTerminalFocus(from: string, to: string): void {
  if (from === to) return;
  if (pendingFocus === from) pendingFocus = to;
  const focus = focusers.get(from);
  if (!focus) return;
  focusers.delete(from);
  focusers.set(to, focus);
}
