import { useState } from "react";

import { changedFileBadge } from "./changedFileBadge";
import {
  changedFileGroups,
  fileName,
  type ChangedFileRow,
} from "./changedFileGroups";

/**
 * The changed files for one checkout, grouped by collapsible directory.
 *
 * Paths used to truncate mid-directory, so eight neighbouring rows read the
 * same. The directory becomes a group heading, the filename is never truncated,
 * and the counts hold a fixed column so they line up down the list. Each
 * heading collapses its files, so a long change set folds down to its
 * directories. The list stays flat: headings are presentational and every
 * listitem is a file.
 */
export function ChangedFilesList({
  files,
  label,
  descriptionPrefix,
  selectedPath,
  onSelect,
}: {
  files: readonly ChangedFileRow[];
  label: string;
  descriptionPrefix: string;
  selectedPath?: string | null;
  onSelect?: (path: string) => void;
}) {
  const groups = changedFileGroups(files);
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const toggle = (directory: string) =>
    setCollapsed((current) =>
      current.includes(directory)
        ? current.filter((entry) => entry !== directory)
        : [...current, directory],
    );
  let index = -1;
  return (
    <ul aria-label={label} className="border-t border-pane-border">
      {groups.map((group) => {
        const directory = group.directory || "repository root";
        const open = !collapsed.includes(group.directory);
        return [
          <li key={`heading:${group.directory}`} role="presentation">
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${directory}: ${group.files.length} files`}
              onClick={() => toggle(group.directory)}
              className="flex w-full min-w-0 items-center gap-1 px-3 pb-0.5 pt-2 text-left font-mono text-xs text-text-muted hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent"
            >
              <span aria-hidden="true" className="w-2 shrink-0">{open ? "▾" : "▸"}</span>
              <span className="min-w-0 flex-1 truncate" title={directory}>{directory}</span>
              <span className="shrink-0 tabular-nums">{group.files.length}</span>
            </button>
          </li>,
          ...group.files.map((file) => {
            index += 1;
            const badge = changedFileBadge(file.status);
            const descriptionId = `${descriptionPrefix}-${index}-description`;
            const selected = selectedPath === file.path;
            return (
              <li
                key={file.path}
                hidden={!open}
                aria-label={`${file.path}: ${badge.label}`}
                aria-describedby={descriptionId}
                className={selected ? "bg-pane-selected" : ""}
              >
                <button
                  type="button"
                  aria-label={file.path}
                  aria-pressed={selected}
                  onClick={() => onSelect?.(file.path)}
                  className="flex w-full min-w-0 items-center gap-3 px-3 py-1 text-left font-mono text-xs hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent"
                >
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
          }),
        ];
      })}
    </ul>
  );
}
