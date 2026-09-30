import type { RefObject } from "react";

export function canReceiveRestoredFocus(
  element: HTMLElement | null,
): element is HTMLElement {
  if (!element?.isConnected) return false;
  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  return element.getAttribute("aria-disabled") !== "true";
}

function changesWorkspaceRoot(element: HTMLElement | null): HTMLElement | null {
  return element?.closest<HTMLElement>('[data-testid="changes-workspace-scroll"]')
    ?? null;
}

export function focusConfirmationCancel(cancel: HTMLButtonElement | null): void {
  if (canReceiveRestoredFocus(cancel)) cancel.focus();
}

export function confirmationOwnsFocus(
  confirmation: RefObject<HTMLElement>,
): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement
    && (confirmation.current?.contains(active) === true || !active.isConnected);
}

export function restoreChangesConfirmationFocus(
  opener: HTMLElement | null,
  section: HTMLElement | null,
): void {
  const root = changesWorkspaceRoot(opener) ?? changesWorkspaceRoot(section);
  const workspace = root?.querySelector<HTMLElement>('[data-testid="changes-workspace"]')
    ?? null;
  const target = canReceiveRestoredFocus(opener)
    ? opener
    : canReceiveRestoredFocus(section)
      ? section
      : root?.querySelector<HTMLElement>('[aria-controls="changes-branch-inspector"]:not(:disabled)')
        ?? workspace
        ?? root?.querySelector<HTMLElement>("[data-changes-keyboard-entry]:not(:disabled)")
        ?? null;
  if (!target) return;
  if (!canReceiveRestoredFocus(target)) return;
  if (target.tabIndex < 0 && target === workspace) {
    target.tabIndex = -1;
  }
  target.focus();
}
