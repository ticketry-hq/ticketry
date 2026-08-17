/**
 * Blocks the WebView's page-background context menu in the desktop application.
 *
 * The native right-click menu on the page background exposes Reload, which
 * tears the document down outside every recovery policy: it skips the
 * render-recovery campaign's backoff and replays whatever the host still
 * retains, so the document lifecycle must not be user-reachable through it.
 * Editable fields keep their menu — there a right-click means Cut/Copy/Paste
 * and never Reload. The browser build never installs this; a browser tab's
 * context menu belongs to the user.
 */
export function suppressNativeContextMenu(target: Window = window): () => void {
  const block = (event: Event) => {
    if (editableTarget(event.target)) return;
    event.preventDefault();
  };
  target.addEventListener("contextmenu", block);
  return () => {
    target.removeEventListener("contextmenu", block);
  };
}

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) return !target.readOnly;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  return target instanceof HTMLElement && target.isContentEditable;
}
