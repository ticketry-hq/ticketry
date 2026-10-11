import { useLayoutEffect, useRef, type MouseEvent } from "react";

export function focusKeyboardDecision(event: MouseEvent<HTMLElement>): void {
  if (event.detail !== 0 || document.activeElement !== event.currentTarget) return;
  const control = event.currentTarget;
  const row = control.closest<HTMLElement>("[data-plan-suggestion]");
  const target = row ? nextSuggestionFocus(row)
    : control.closest("aside")?.querySelector<HTMLButtonElement>('button[aria-label="Close selected ticket"]')
      ?? control.closest("section")?.querySelector("h2");
  target?.focus();
}

export function useRemovalFocus<T extends HTMLElement>(destination: (element: T) => HTMLElement | null) {
  const element = useRef<T>(null);
  const target = useRef(destination);
  target.current = destination;
  useLayoutEffect(() => () => {
    const removed = element.current;
    if (removed?.contains(document.activeElement)) target.current(removed)?.focus();
  }, []);
  return element;
}

export function nextSuggestionFocus(row: HTMLElement): HTMLElement | null {
  const pane = row.closest("section");
  const rows = [...(pane?.querySelectorAll<HTMLElement>("[data-plan-suggestion]") ?? [])];
  const at = rows.indexOf(row);
  return rows[at + 1] ?? rows[at - 1] ?? pane?.querySelector("h2") ?? null;
}

export function reviewFocus(panel: HTMLElement, openItem: string): HTMLElement | null {
  const plan = panel.closest('[data-testid="plan-sprint"]') ?? panel.parentElement;
  const rows = [...(plan?.querySelectorAll<HTMLElement>("[data-plan-suggestion], [data-plan-story]") ?? [])];
  const selected = rows.find((row) => row.dataset.planStory === openItem
    || `suggestion:${row.dataset.planSuggestion}` === openItem);
  return selected ?? rows[0] ?? plan?.querySelector('[data-testid="plan-backlog"] h2') ?? null;
}
