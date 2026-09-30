/**
 * Arrow-key hops between the three Changes zones: toolbar, files, diff.
 *
 * Each zone owns its arrows internally (listbox, tree, scroll). At the edge
 * of a zone the same arrow crosses into the neighbour: Down from the toolbar
 * lands on the files, Up from the first file returns, Right from a file opens
 * the diff for reading, and Left from an unscrolled diff returns to the files.
 * Everything resolves through the DOM so no zone has to know the others exist.
 */
const ROOT = '[data-testid="changes-workspace-scroll"]';

function root(from: HTMLElement): HTMLElement | null {
  return from.closest<HTMLElement>(ROOT);
}

function focus(target: HTMLElement | null | undefined): boolean {
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  return true;
}

export function focusChangesToolbar(from: HTMLElement): boolean {
  return focus(root(from)?.querySelector<HTMLElement>('[aria-label="Choose checkout"]'));
}

/** The selected file when there is one, else the first visible row, else the empty notice. */
export function focusChangedFiles(from: HTMLElement): boolean {
  const scope = root(from);
  if (!scope) return false;
  return focus(
    scope.querySelector<HTMLElement>('[data-changes-file-row][aria-pressed="true"]')
      ?? scope.querySelector<HTMLElement>("[data-changes-file-row]")
      ?? scope.querySelector<HTMLElement>('[data-testid="changes-files-column"] [role="region"]'),
  );
}

export function focusChangesDiff(from: HTMLElement): boolean {
  return focus(root(from)?.querySelector<HTMLElement>('[data-testid="changes-diff-scroll-region"]'));
}

export function isPlainKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, key: string): boolean {
  return event.key === key && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
