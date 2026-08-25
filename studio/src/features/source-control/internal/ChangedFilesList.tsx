import { useEffect, useMemo, useState } from "react";
import {
  IconChevronDown,
  IconFile,
  IconFolder,
} from "../../../shared/ui/icons";
import type { ChangedFile } from "../types";
import {
  countsLabel,
  fileAccessibleName,
  statusDotTone,
  statusLabel,
} from "./changePresentation";
import {
  buildChangedFileTree,
  type ChangedFileTreeFolder,
  type ChangedFileTreeNode,
} from "./changedFileTree";

/**
 * The read-only tree of changed files.
 *
 * Selection here picks what the diff viewer shows — it is not curation. The
 * stacked Git action commits every changed file, so a row has no checkbox and
 * no way to exclude itself (CODING-961, "commit everything").
 */
export function ChangedFilesList({
  files,
  selectedPath,
  onSelect,
}: {
  files: readonly ChangedFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildChangedFileTree(files), [files]);
  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree]);
  const [foldersExpandedByDefault, setFoldersExpandedByDefault] =
    useState(true);
  const [folderOverrides, setFolderOverrides] = useState<
    Record<string, boolean>
  >({});
  const hasExpandedFolder = Array.from(folderPaths).some(
    (path) => folderOverrides[path] ?? foldersExpandedByDefault,
  );

  useEffect(() => {
    setFolderOverrides((current) => {
      const remaining = Object.entries(current).filter(([path]) =>
        folderPaths.has(path),
      );
      return remaining.length === Object.keys(current).length
        ? current
        : Object.fromEntries(remaining);
    });
  }, [folderPaths]);

  const toggleFolder = (path: string) => {
    setFolderOverrides((current) => {
      const expanded = current[path] ?? foldersExpandedByDefault;
      const next = !expanded;
      if (next === foldersExpandedByDefault) {
        const { [path]: _removed, ...remaining } = current;
        return remaining;
      }
      return { ...current, [path]: next };
    });
  };

  const toggleAllFolders = () => {
    setFoldersExpandedByDefault(!hasExpandedFolder);
    setFolderOverrides({});
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {folderPaths.size > 0 && (
        <div className="flex shrink-0 justify-end border-b border-pane-border px-2 py-1">
          <button
            type="button"
            onClick={toggleAllFolders}
            className="px-1.5 py-0.5 text-xs text-text-secondary outline-none hover:bg-pane-title hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent"
          >
            {hasExpandedFolder
              ? "Collapse all folders"
              : "Expand all folders"}
          </button>
        </div>
      )}
      <div
        role="tree"
        aria-label="Changed files"
        data-testid="changed-files"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tree.map((node) => (
          <ChangedFileNode
            key={nodeKey(node)}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            folderOverrides={folderOverrides}
            foldersExpandedByDefault={foldersExpandedByDefault}
            onToggleFolder={toggleFolder}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function ChangedFileNode({
  node,
  depth,
  selectedPath,
  folderOverrides,
  foldersExpandedByDefault,
  onToggleFolder,
  onSelect,
}: {
  node: ChangedFileTreeNode;
  depth: number;
  selectedPath: string | null;
  folderOverrides: Readonly<Record<string, boolean>>;
  foldersExpandedByDefault: boolean;
  onToggleFolder: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  if (node.kind === "folder") {
    const expanded = folderOverrides[node.path] ?? foldersExpandedByDefault;
    return (
      <div
        role="treeitem"
        aria-expanded={expanded}
        aria-label={folderTreeItemAccessibleName(node, expanded)}
        tabIndex={0}
        onClick={(event) => {
          const folderRow = event.currentTarget.firstElementChild;
          if (
            event.currentTarget === event.target ||
            folderRow?.contains(event.target as Node)
          ) {
            onToggleFolder(node.path);
          }
        }}
        onKeyDown={(event) => {
          if (
            event.currentTarget === event.target &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            onToggleFolder(node.path);
          }
        }}
        className="outline-none focus-visible:ring-1 focus-visible:ring-focus-accent focus-visible:ring-inset"
      >
        <div
          className="flex w-full cursor-pointer items-center gap-1.5 border-l-2 border-transparent py-1.5 pr-3 text-left text-xs text-text-secondary hover:bg-pane-title/60 hover:text-text-primary"
          style={{ paddingLeft: `${12 + depth * 14}px` }}
        >
          <IconChevronDown
            size={12}
            className={`shrink-0 text-text-muted ${expanded ? "" : "-rotate-90"}`}
          />
          <IconFolder size={14} className="shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono">
            {node.label}
          </span>
          {node.stats && (
            <span
              aria-hidden="true"
              className="shrink-0 font-mono text-text-muted"
            >
              +{node.stats.insertions} −{node.stats.deletions}
            </span>
          )}
        </div>
        {expanded && (
          <div role="group">
            {node.children.map((child) => (
              <ChangedFileNode
                key={nodeKey(child)}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                folderOverrides={folderOverrides}
                foldersExpandedByDefault={foldersExpandedByDefault}
                onToggleFolder={onToggleFolder}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const { file } = node;
  const selected = file.path === selectedPath;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-label={fileAccessibleName(file)}
      tabIndex={0}
      onClick={() => onSelect(file.path)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(file.path);
        }
      }}
      className={`flex cursor-pointer items-center gap-2 border-l-2 py-1.5 pr-3 text-xs outline-none ${
        selected
          ? "border-focus-accent bg-pane-title text-text-primary"
          : "border-transparent text-text-secondary hover:bg-pane-title/60"
      } focus-visible:ring-1 focus-visible:ring-focus-accent focus-visible:ring-inset`}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
    >
      <span
        aria-hidden="true"
        title={statusLabel(file.status)}
        className={`h-1.5 w-1.5 shrink-0 ${statusDotTone(file.status)}`}
      />
      <IconFile size={14} className="shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
      <span
        aria-hidden="true"
        className="shrink-0 font-mono text-text-muted"
      >
        {countsLabel(file)}
      </span>
    </div>
  );
}

function nodeKey(node: ChangedFileTreeNode): string {
  return node.kind === "folder"
    ? `folder:${node.path}`
    : `file:${node.file.path}`;
}

function folderAccessibleName(folder: ChangedFileTreeFolder): string {
  const stats = folder.stats
    ? `, +${folder.stats.insertions} −${folder.stats.deletions}`
    : "";
  return `${folder.path} folder${stats}`;
}

function folderTreeItemAccessibleName(
  folder: ChangedFileTreeFolder,
  expanded: boolean,
): string {
  return `${expanded ? "Collapse" : "Expand"} ${folderAccessibleName(folder)}`;
}

function collectFolderPaths(nodes: readonly ChangedFileTreeNode[]): Set<string> {
  const paths = new Set<string>();
  const visit = (node: ChangedFileTreeNode) => {
    if (node.kind === "file") return;
    paths.add(node.path);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return paths;
}
