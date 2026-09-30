export interface ChangedFileRow {
  path: string;
  previous_path?: string | null;
  status: string;
  binary?: boolean;
  insertions?: number | null;
  deletions?: number | null;
}

/** One rendered row: a directory heading, or a file at its tree depth. */
export type ChangedFileTreeRow =
  | {
      kind: "directory";
      path: string;
      name: string;
      depth: number;
      fileCount: number;
      insertions: number;
      deletions: number;
    }
  | { kind: "file"; depth: number; file: ChangedFileRow };

interface DirectoryNode {
  name: string;
  path: string;
  directories: Map<string, DirectoryNode>;
  files: ChangedFileRow[];
}

const COLLATION: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

function pathSegments(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

export function fileName(path: string): string {
  return pathSegments(path).at(-1) ?? path;
}

function newDirectory(name: string, path: string): DirectoryNode {
  return { name, path, directories: new Map(), files: [] };
}

function insert(root: DirectoryNode, file: ChangedFileRow): void {
  const parts = pathSegments(file.path);
  if (parts.length === 0) return;
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    const path = directory.path ? `${directory.path}/${part}` : part;
    let child = directory.directories.get(part);
    if (!child) {
      child = newDirectory(part, path);
      directory.directories.set(part, child);
    }
    directory = child;
  }
  directory.files.push(file);
}

/**
 * A directory whose only child is another directory is chained into one
 * `a/b/c` row, so a deep repository does not spend a row and an indent level
 * on every empty level.
 */
function chain(directory: DirectoryNode): DirectoryNode {
  let node = directory;
  while (node.files.length === 0 && node.directories.size === 1) {
    const [only] = [...node.directories.values()];
    node = { ...only, name: `${node.name}/${only.name}` };
  }
  return node;
}

function totals(directory: DirectoryNode): {
  fileCount: number;
  insertions: number;
  deletions: number;
} {
  const sum = { fileCount: 0, insertions: 0, deletions: 0 };
  for (const file of directory.files) {
    sum.fileCount += 1;
    sum.insertions += file.insertions ?? 0;
    sum.deletions += file.deletions ?? 0;
  }
  for (const child of directory.directories.values()) {
    const childTotals = totals(child);
    sum.fileCount += childTotals.fileCount;
    sum.insertions += childTotals.insertions;
    sum.deletions += childTotals.deletions;
  }
  return sum;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, COLLATION);
}

function appendRows(
  directory: DirectoryNode,
  depth: number,
  collapsed: readonly string[],
  rows: ChangedFileTreeRow[],
): void {
  const children = [...directory.directories.values()].map(chain).sort(byName);
  for (const child of children) {
    rows.push({ kind: "directory", path: child.path, name: child.name, depth, ...totals(child) });
    if (collapsed.includes(child.path)) continue;
    appendRows(child, depth + 1, collapsed, rows);
  }
  const files = [...directory.files].sort((a, b) =>
    fileName(a.path).localeCompare(fileName(b.path), undefined, COLLATION),
  );
  for (const file of files) rows.push({ kind: "file", depth, file });
}

/**
 * Flatten one checkout's changed files into editor-sidebar tree rows.
 *
 * Directories sort before files, both in natural order. Rows come back flat so
 * the list keeps one listitem per file; depth carries the indentation.
 */
export function changedFileTreeRows(
  files: readonly ChangedFileRow[],
  collapsed: readonly string[] = [],
): readonly ChangedFileTreeRow[] {
  const root = newDirectory("", "");
  for (const file of files) insert(root, file);
  const rows: ChangedFileTreeRow[] = [];
  appendRows(root, 0, collapsed, rows);
  return rows;
}
