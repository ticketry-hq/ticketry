import { useLayoutEffect, useRef, type KeyboardEvent, type FocusEvent } from "react";

function tabs(strip: HTMLDivElement): HTMLButtonElement[] {
  return [...strip.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].filter((tab) => !tab.disabled);
}

export function useWorkspaceTabNavigation() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const enabled = tabs(ref.current);
    const selected = enabled.find((tab) => tab.getAttribute("aria-selected") === "true") ?? enabled[0];
    for (const tab of enabled) tab.tabIndex = tab === selected ? 0 : -1;
  });
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement) || event.target.getAttribute("role") !== "tab") return;
    for (const tab of tabs(event.currentTarget)) tab.tabIndex = tab === event.target ? 0 : -1;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!(event.target instanceof HTMLButtonElement) || event.target.getAttribute("role") !== "tab") return;
    const enabled = tabs(event.currentTarget);
    const index = enabled.indexOf(event.target);
    const next = event.key === "ArrowRight" ? enabled[(index + 1) % enabled.length]
      : event.key === "ArrowLeft" ? enabled[(index - 1 + enabled.length) % enabled.length]
      : event.key === "Home" ? enabled[0]
      : event.key === "End" ? enabled[enabled.length - 1] : undefined;
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    next.click();
    next.focus();
  };
  return { ref, onFocus, onKeyDown };
}
