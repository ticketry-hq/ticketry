import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { resolveCaptureKeymapAction } from "../../../../shared/navigation/keymapResolver";
import { changedFileBadge } from "./changedFileBadge";
import { changedFileGroups, fileName, type ChangedFileRow } from "./changedFileGroups";
import { CHANGES_FILE_ACTIONS, type ChangesFileAction } from "./changesKeyboardNavigation";

const directoryKey = (directory: string) => `directory:${directory}`;
const fileKey = (path: string) => `file:${path}`;

/** A grouped file list whose local keys move focus without changing selection. */
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
  const groups = useMemo(() => changedFileGroups(files), [files]);
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const emptyRef = useRef<HTMLDivElement>(null);
  const focusedKey = useRef<string | null>(null);
  const focusOwned = useRef(false);
  const previousVisibleKeys = useRef<readonly string[]>([]);
  const visibleKeys = groups.flatMap((group) => [
    directoryKey(group.directory),
    ...(collapsed.includes(group.directory) ? [] : group.files.map((file) => fileKey(file.path))),
  ]);
  const visibleSignature = visibleKeys.join("\u0000");

  useLayoutEffect(() => {
    if (!focusOwned.current || !focusedKey.current) {
      previousVisibleKeys.current = visibleKeys;
      return;
    }
    const activeKey = document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.changesFileRow
      : undefined;
    if (activeKey && rowRefs.current.has(activeKey)) {
      previousVisibleKeys.current = visibleKeys;
      return;
    }
    const sameRow = rowRefs.current.get(focusedKey.current);
    if (sameRow) {
      sameRow.focus();
      sameRow.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      previousVisibleKeys.current = visibleKeys;
      return;
    }
    const previousIndex = previousVisibleKeys.current.indexOf(focusedKey.current);
    const fallbackKey = visibleKeys[Math.min(Math.max(previousIndex, 0), visibleKeys.length - 1)];
    const fallback = fallbackKey ? rowRefs.current.get(fallbackKey) : emptyRef.current;
    fallback?.focus();
    fallback?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    focusedKey.current = fallbackKey ?? null;
    previousVisibleKeys.current = visibleKeys;
  }, [checkoutKey, visibleSignature]);

  const focusRow = (key: string | undefined) => {
    const row = key ? rowRefs.current.get(key) : undefined;
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  const toggle = (directory: string, disclosure: HTMLButtonElement) => {
    disclosure.focus();
    setCollapsed((current) => current.includes(directory)
      ? current.filter((entry) => entry !== directory)
      : [...current, directory]);
  };
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    key: string,
    directory?: string,
  ) => {
    const action = resolveCaptureKeymapAction(event.nativeEvent, CHANGES_FILE_ACTIONS) as ChangesFileAction | null;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const index = visibleKeys.indexOf(key);
    if (action === "changes.file.previous") focusRow(visibleKeys[Math.max(0, index - 1)]);
    else if (action === "changes.file.next") focusRow(visibleKeys[Math.min(visibleKeys.length - 1, index + 1)]);
    else if (action === "changes.file.first") focusRow(visibleKeys[0]);
    else if (action === "changes.file.last") focusRow(visibleKeys.at(-1));
    else if (action === "changes.file.activate") {
      if (directory !== undefined) toggle(directory, event.currentTarget);
      else onSelect?.(key.slice("file:".length));
    } else if (action === "changes.file.expand" && directory !== undefined && collapsed.includes(directory)) {
      toggle(directory, event.currentTarget);
    } else if (action === "changes.file.collapse" && directory !== undefined && !collapsed.includes(directory)) {
      toggle(directory, event.currentTarget);
    }
  };

  if (files.length === 0) {
    return (
      <div
        ref={emptyRef}
        role="region"
        tabIndex={0}
        aria-label={`${label} empty`}
        className="text-sm text-text-muted focus-visible:ring-1 focus-visible:ring-focus-accent"
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
      {groups.map((group) => {
        const directory = group.directory || "repository root";
        const open = !collapsed.includes(group.directory);
        const groupKey = directoryKey(group.directory);
        return [
          <li key={`heading:${group.directory}`} role="presentation">
            <button
              ref={(node) => { if (node) rowRefs.current.set(groupKey, node); else rowRefs.current.delete(groupKey); }}
              data-changes-file-row={groupKey}
              type="button"
              aria-expanded={open}
              aria-label={directory}
              onFocus={() => { focusedKey.current = groupKey; }}
              onClick={(event) => toggle(group.directory, event.currentTarget)}
              onKeyDown={(event) => handleKeyDown(event, groupKey, group.directory)}
              className="flex w-full min-w-0 items-center gap-1 px-3 pb-0.5 pt-2 text-left font-mono text-xs text-text-muted hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent"
            >
              <span aria-hidden="true" className="w-2 shrink-0">{open ? "▾" : "▸"}</span>
              <span className="min-w-0 flex-1 truncate" title={directory}>{directory}</span>
              <span aria-hidden="true" className="shrink-0 tabular-nums">{group.files.length}</span>
            </button>
          </li>,
          ...group.files.map((file) => {
            index += 1;
            const badge = changedFileBadge(file.status);
            const descriptionId = `${descriptionPrefix}-${index}-description`;
            const selected = selectedPath === file.path;
            const rowKey = fileKey(file.path);
            return (
              <li key={file.path} hidden={!open} aria-label={`${file.path}: ${badge.label}`} aria-describedby={descriptionId} className={selected ? "bg-pane-selected" : ""}>
                <button
                  ref={(node) => { if (node && open) rowRefs.current.set(rowKey, node); else rowRefs.current.delete(rowKey); }}
                  data-changes-file-row={rowKey}
                  type="button"
                  aria-label={file.path}
                  aria-pressed={selected}
                  onFocus={() => { focusedKey.current = rowKey; }}
                  onClick={() => onSelect?.(file.path)}
                  onKeyDown={(event) => handleKeyDown(event, rowKey)}
                  className="flex w-full min-w-0 items-center gap-3 px-3 py-1 text-left font-mono text-xs hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent"
                >
                  <span aria-hidden="true" className={`w-3 shrink-0 text-center font-bold ${badge.toneClass}`}>{badge.letter}</span>
                  <span className="min-w-0 flex-1 truncate text-text-primary">{fileName(file.path)}</span>
                  {file.previous_path ? <span className="shrink-0 text-text-muted">renamed</span> : null}
                  {file.binary || file.insertions == null ? null : (
                    <span className="shrink-0 tabular-nums text-text-muted">
                      <span className="text-lifecycle-success">+{file.insertions}</span>{" "}
                      <span className="text-lifecycle-danger">-{file.deletions}</span>
                    </span>
                  )}
                </button>
                <span id={descriptionId} className="sr-only">
                  {badge.explanation}{file.previous_path ? ` Moved from ${file.previous_path}.` : ""}
                </span>
              </li>
            );
          }),
        ];
      })}
    </ul>
  );
}
