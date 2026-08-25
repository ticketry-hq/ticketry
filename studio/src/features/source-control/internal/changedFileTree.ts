import type { ChangedFile } from "../types";

export interface ChangedFileTreeFile {
  kind: "file";
  name: string;
  normalizedPath: string;
  file: ChangedFile;
}

export interface ChangedFileTreeFolder {
  kind: "folder";
  label: string;
  path: string;
  stats: ChangedFileTreeStats | null;
  children: ChangedFileTreeNode[];
}

export interface ChangedFileTreeStats {
  insertions: number;
  deletions: number;
}

export type ChangedFileTreeNode =
  | ChangedFileTreeFolder
  | ChangedFileTreeFile;

interface MutableFolder {
  name: string;
  path: string;
  order: number;
  folders: Map<string, MutableFolder>;
  files: MutableFile[];
}

interface MutableFile {
  node: ChangedFileTreeFile;
  order: number;
}

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const mutableFolder = (
  name: string,
  path: string,
  order: number,
): MutableFolder => ({
  name,
  path,
  order,
  folders: new Map(),
  files: [],
});

function compareNamed(
  left: { name: string; order: number },
  right: { name: string; order: number },
): number {
  return nameCollator.compare(left.name, right.name) || left.order - right.order;
}

function fileStats(file: ChangedFile): ChangedFileTreeStats | null {
  if (
    file.binary ||
    (file.insertions === null && file.deletions === null)
  ) {
    return null;
  }
  return {
    insertions: file.insertions ?? 0,
    deletions: file.deletions ?? 0,
  };
}

function addStats(
  total: ChangedFileTreeStats | null,
  next: ChangedFileTreeStats | null,
): ChangedFileTreeStats | null {
  if (!next) return total;
  if (!total) return { ...next };
  return {
    insertions: total.insertions + next.insertions,
    deletions: total.deletions + next.deletions,
  };
}

function compactFolder(folder: MutableFolder): ChangedFileTreeFolder {
  let compacted = folder;
  const names = [folder.name];

  while (compacted.files.length === 0 && compacted.folders.size === 1) {
    compacted = compacted.folders.values().next().value as MutableFolder;
    names.push(compacted.name);
  }

  const folders = Array.from(compacted.folders.values()).sort(compareNamed);
  const files = [...compacted.files].sort((left, right) =>
    compareNamed(
      { name: left.node.name, order: left.order },
      { name: right.node.name, order: right.order },
    ),
  );
  const children: ChangedFileTreeNode[] = [
    ...folders.map(compactFolder),
    ...files.map(({ node }) => node),
  ];
  const stats = children.reduce<ChangedFileTreeStats | null>(
    (total, child) =>
      addStats(total, child.kind === "folder" ? child.stats : fileStats(child.file)),
    null,
  );

  return {
    kind: "folder",
    label: names.join("/"),
    path: compacted.path,
    stats,
    children,
  };
}

export function buildChangedFileTree(
  files: readonly ChangedFile[],
): ChangedFileTreeNode[] {
  const root = mutableFolder("", "", -1);

  files.forEach((file, order) => {
    const segments = file.path.split(/[\\/]+/).filter(Boolean);
    const name = segments.at(-1) ?? file.path;
    const normalizedPath = segments.join("/");
    let parent = root;

    for (const segment of segments.slice(0, -1)) {
      const path = parent.path ? `${parent.path}/${segment}` : segment;
      let child = parent.folders.get(segment);
      if (!child) {
        child = mutableFolder(segment, path, order);
        parent.folders.set(segment, child);
      }
      parent = child;
    }

    parent.files.push({
      node: { kind: "file", name, normalizedPath, file },
      order,
    });
  });

  return [
    ...Array.from(root.folders.values()).sort(compareNamed).map(compactFolder),
    ...[...root.files]
      .sort((left, right) =>
        compareNamed(
          { name: left.node.name, order: left.order },
          { name: right.node.name, order: right.order },
        ),
      )
      .map(({ node }) => node),
  ];
}
