/** True when a keyboard event targets a text-entry surface. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    target.getAttribute("contenteditable") === "true"
  );
}

/** True when focus is intentionally parked in a dialog outside a focus zone. */
export function isDialogFocusTarget(target: Element | null): boolean {
  return target instanceof HTMLElement && target.closest('[role="dialog"]') !== null;
}
