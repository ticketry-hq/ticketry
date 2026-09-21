import { useState } from "react";

import { changedFileBadge } from "./changedFileBadge";
import {
  changedFileTreeRows,
  fileName,
  type ChangedFileRow,
} from "./changedFileTree";

const INDENT_STEP = 12;
const ROOT_INDENT = 8;

function indent(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${ROOT_INDENT + depth * INDENT_STEP}px` };
}

/**
 * The changed files for one checkout, as an editor-sidebar tree.
 *
 * Paths used to truncate mid-directory, so eight neighbouring rows read the
 * same. Directories nest and indent, a directory with a single directory child
 * chains into one `a/b/c` row, and the counts hold a fixed column so they line
 * up down the list. The rows stay flat in the DOM: directory rows are
 * presentational and every listitem is a file.
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
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const rows = changedFileTreeRows(files, collapsed);
  const toggle = (path: string) =>
    setCollapsed((current) =>
      current.includes(path)
        ? current.filter((entry) => entry !== path)
        : [...current, path],
    );
  let index = -1;
  return (
    <ul aria-label={label} className="border-t border-pane-border">
      {rows.map((row) => {
        if (row.kind === "directory") {
          const open = !collapsed.includes(row.path);
          return (
            <li key={`directory:${row.path}`} role="presentation">
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${row.path}: ${row.fileCount} files`}
                title={row.path}
                onClick={() => toggle(row.path)}
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
            key={file.path}
            aria-label={`${file.path}: ${badge.label}`}
            aria-describedby={descriptionId}
            className={selected ? "bg-pane-selected" : ""}
          >
            <button
              type="button"
              aria-label={file.path}
              aria-pressed={selected}
              title={file.path}
              onClick={() => onSelect?.(file.path)}
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
