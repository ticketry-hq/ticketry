/**
 * Live terminal capabilities. Renderer objects and focus callbacks are runtime
 * resources, not application state, so they live in this module registry.
 */
import { modalOcclusionActive, onModalOcclusionBegin } from "./modalOcclusion";

type FocusTerminal = () => void;

const focusers = new Map<string, FocusTerminal>();
// Selecting a tab focuses its terminal in the same tick, before that terminal
// has become visible and registered a focuser. The request is held for exactly
// one session — a later selection supersedes it — and delivered on registration.
let pendingFocus: string | null = null;
let releaseOcclusionWatch: (() => void) | null = null;

/**
 * Hold (or drop, with `null`) the single banked focus request.
 *
 * A held request only survives while the window stays unoccluded. A modal
 * opening ends the episode the request belongs to: the dialog's focus trap owns
 * the foreground, and the reveal that follows its close would otherwise deliver
 * the request late and pull focus out of whatever the modal restored it to.
 */
function bankFocus(sessionId: string | null): void {
  pendingFocus = sessionId;
  releaseOcclusionWatch?.();
  releaseOcclusionWatch = sessionId
    ? onModalOcclusionBegin(() => bankFocus(null))
    : null;
}

export function registerTerminalFocus(
  sessionId: string,
  focus: FocusTerminal,
): () => void {
  focusers.set(sessionId, focus);
  if (pendingFocus === sessionId) {
    bankFocus(null);
    focus();
  }
  return () => {
    if (focusers.get(sessionId) === focus) focusers.delete(sessionId);
  };
}

export function focusTerminal(sessionId: string): void {
  // A modal owns the window foreground, so its focus trap — not a terminal —
  // is entitled to focus. Drop the request instead of banking it: holding it
  // would let the reveal that follows the modal's close pull focus back out of
  // whatever the modal restored it to.
  if (modalOcclusionActive()) return;
  const focus = focusers.get(sessionId);
  bankFocus(focus ? null : sessionId);
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
