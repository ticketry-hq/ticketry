import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { resolveCaptureKeymapAction } from "../../../../shared/navigation/keymapResolver";
import { changedFileBadge } from "./changedFileBadge";
import {
  changedFileTreeRows,
  fileName,
  type ChangedFileRow,
  type ChangedFileTreeRow,
} from "./changedFileTree";
import { CHANGES_FILE_ACTIONS, type ChangesFileAction } from "./changesKeyboardNavigation";

const INDENT_STEP = 12;
const ROOT_INDENT = 8;

function indent(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${ROOT_INDENT + depth * INDENT_STEP}px` };
}

function rowKey(row: ChangedFileTreeRow): string {
  return row.kind === "directory" ? `directory:${row.path}` : `file:${row.file.path}`;
}

/**
 * The changed files for one checkout, as an editor-sidebar tree.
 *
 * Paths used to truncate mid-directory, so eight neighbouring rows read the
 * same. Directories nest and indent, a directory with a single directory child
 * chains into one `a/b/c` row, and the counts hold a fixed column so they line
 * up down the list. The rows stay flat in the DOM: directory rows are
 * presentational and every listitem is a file.
 *
 * Keyboard: arrows move focus between visible rows without changing the
 * selection, Left/Right collapse and expand a directory, Enter or Space
 * activates. Focus follows a row's path across refreshes; when the focused row
 * disappears, the row now at its position takes over, or the empty message.
 */
export function ChangedFilesList({
  checkoutKey,
  files,
  label,
  descriptionPrefix,
  selectedPath,
  emptyMessage = "No changed files.",
  onSelect,
}: {
  checkoutKey?: string;
  files: readonly ChangedFileRow[];
  label: string;
  descriptionPrefix: string;
  selectedPath?: string | null;
  emptyMessage?: string;
  onSelect?: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const rows = changedFileTreeRows(files, collapsed);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const emptyRef = useRef<HTMLDivElement>(null);
  const focusedKey = useRef<string | null>(null);
  const focusOwned = useRef(false);
  const previousKeys = useRef<readonly string[]>([]);
  const visibleKeys = rows.map(rowKey);
  const visibleSignature = visibleKeys.join("\u0000");

  const focusRow = (key: string | undefined) => {
    const row = key ? rowRefs.current.get(key) : undefined;
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  useLayoutEffect(() => {
    const previous = previousKeys.current;
    previousKeys.current = visibleKeys;
    if (!focusOwned.current || !focusedKey.current) return;
    const active = document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.changesFileRow
      : undefined;
    if (active && rowRefs.current.has(active)) return;
    if (rowRefs.current.has(focusedKey.current)) {
      focusRow(focusedKey.current);
      return;
    }
    const previousIndex = previous.indexOf(focusedKey.current);
    const fallbackKey = visibleKeys[Math.min(Math.max(previousIndex, 0), visibleKeys.length - 1)];
    if (fallbackKey) focusRow(fallbackKey);
    else emptyRef.current?.focus();
    focusedKey.current = fallbackKey ?? null;
  }, [checkoutKey, visibleSignature]);

  const toggle = (path: string, disclosure?: HTMLButtonElement) => {
    disclosure?.focus();
    setCollapsed((current) =>
      current.includes(path)
        ? current.filter((entry) => entry !== path)
        : [...current, path],
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, row: ChangedFileTreeRow) => {
    const action = resolveCaptureKeymapAction(
      event.nativeEvent,
      CHANGES_FILE_ACTIONS,
    ) as ChangesFileAction | null;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const index = visibleKeys.indexOf(rowKey(row));
    const directory = row.kind === "directory" ? row.path : undefined;
    const isCollapsed = directory !== undefined && collapsed.includes(directory);
    if (action === "changes.file.previous") focusRow(visibleKeys[Math.max(0, index - 1)]);
    else if (action === "changes.file.next") focusRow(visibleKeys[Math.min(visibleKeys.length - 1, index + 1)]);
    else if (action === "changes.file.first") focusRow(visibleKeys[0]);
    else if (action === "changes.file.last") focusRow(visibleKeys.at(-1));
    else if (action === "changes.file.activate") {
      if (directory !== undefined) toggle(directory, event.currentTarget);
      else if (row.kind === "file") onSelect?.(row.file.path);
    } else if (action === "changes.file.expand" && directory !== undefined && isCollapsed) {
      toggle(directory, event.currentTarget);
    } else if (action === "changes.file.collapse" && directory !== undefined && !isCollapsed) {
      toggle(directory, event.currentTarget);
    }
  };

  const register = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) rowRefs.current.set(key, node);
    else rowRefs.current.delete(key);
  };

  if (files.length === 0) {
    return (
      <div
        ref={emptyRef}
        role="region"
        tabIndex={0}
        aria-label={`${label} empty`}
        className="p-3 text-sm text-text-muted focus-visible:ring-1 focus-visible:ring-focus-accent"
      >
        {emptyMessage}
      </div>
    );
  }

  let index = -1;
  return (
    <ul
      aria-label={label}
      className="border-t border-pane-border"
      onFocusCapture={() => { focusOwned.current = true; }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusOwned.current = false;
      }}
    >
      {rows.map((row) => {
        const key = rowKey(row);
        if (row.kind === "directory") {
          const open = !collapsed.includes(row.path);
          return (
            <li key={key} role="presentation">
              <button
                ref={register(key)}
                data-changes-file-row={key}
                type="button"
                aria-expanded={open}
                aria-label={row.path}
                title={`${row.path}: ${row.fileCount} files`}
                onFocus={() => { focusedKey.current = key; }}
                onClick={(event) => toggle(row.path, event.currentTarget)}
                onKeyDown={(event) => handleKeyDown(event, row)}
                style={indent(row.depth)}
                className="flex w-full min-w-0 items-center gap-1 py-0.5 pr-3 text-left font-mono text-xs text-text-muted hover:bg-pane-title hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent"
              >
                <span
                  aria-hidden="true"
                  className={`w-3 shrink-0 text-center transition-transform ${open ? "rotate-90" : ""}`}
                >
                  ›
                </span>
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-lifecycle-success">+{row.insertions}</span>{" "}
                  <span className="text-lifecycle-danger">-{row.deletions}</span>
                </span>
              </button>
            </li>
          );
        }
        const file = row.file;
        index += 1;
        const badge = changedFileBadge(file.status);
        const descriptionId = `${descriptionPrefix}-${index}-description`;
        const selected = selectedPath === file.path;
        return (
          <li
            key={key}
            aria-label={`${file.path}: ${badge.label}`}
            aria-describedby={descriptionId}
            className={selected ? "bg-pane-selected" : ""}
          >
            <button
              ref={register(key)}
              data-changes-file-row={key}
              type="button"
              aria-label={file.path}
              aria-pressed={selected}
              title={file.path}
              onFocus={() => { focusedKey.current = key; }}
              onClick={() => onSelect?.(file.path)}
              onKeyDown={(event) => handleKeyDown(event, row)}
              style={indent(row.depth)}
              className="flex w-full min-w-0 items-center gap-2 py-0.5 pr-3 text-left font-mono text-xs hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent"
            >
              <span aria-hidden="true" className="w-3 shrink-0" />
              <span
                aria-hidden="true"
                className={`w-3 shrink-0 text-center font-bold ${badge.toneClass}`}
              >
                {badge.letter}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-primary">
                {fileName(file.path)}
              </span>
              {file.previous_path ? (
                <span className="shrink-0 text-text-muted">renamed</span>
              ) : null}
              {file.binary ? null : file.insertions != null ? (
                <span className="shrink-0 tabular-nums text-text-muted">
                  <span className="text-lifecycle-success">+{file.insertions}</span>{" "}
                  <span className="text-lifecycle-danger">-{file.deletions}</span>
                </span>
              ) : null}
            </button>
            <span id={descriptionId} className="sr-only">
              {badge.explanation}
              {file.previous_path ? ` Moved from ${file.previous_path}.` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
