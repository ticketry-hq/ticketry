const EDITABLE_SELECTOR = "[contenteditable=\"true\"]";

function enabledEditable(root: HTMLElement): HTMLElement | null {
  const editable = root.querySelector<HTMLElement>(EDITABLE_SELECTOR);
  return editable && !editable.matches(":disabled") && editable.getAttribute("aria-disabled") !== "true"
    ? editable
    : null;
}

/** Observe editor setup briefly; the observer disconnects on readiness, cleanup, or timeout. */
export function observeEnabledRichTextEditable(
  root: HTMLElement,
  onReady: () => void,
  timeoutMs = 5_000,
): () => void {
  if (enabledEditable(root)) {
    onReady();
    return () => {};
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    if (enabledEditable(root)) {
      observer.disconnect();
      clearTimeout(timeout);
      onReady();
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["contenteditable", "aria-disabled", "disabled"] });
  timeout = setTimeout(() => observer.disconnect(), timeoutMs);
  return () => {
    observer.disconnect();
    clearTimeout(timeout);
  };
}
